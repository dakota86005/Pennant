import Darwin
import Foundation
import LocalAuthentication
import Security

// Self-contained on purpose (Foundation, Security, LocalAuthentication only): `macos/scripts/keychain-no-prompt.sh`
// compiles this file with a small probe on CI to prove, with re-signed copies, that nothing here shows a dialog.

/// The generic passwords of one Keychain service, kept per provider, read and written without ever asking the person at
/// the Mac anything (N13, D-074).
///
/// The items live in the login keychain (file-based): the data-protection keychain needs an application-identifier
/// entitlement, so a provisioning profile, which a Developer ID app does not have by default. On a file-based keychain
/// an item's access list trusts the app that created it; another copy (a development build signed ad hoc, rebuilt)
/// reading it would make the system ask the person to allow it. `kSecUseAuthenticationUI` and
/// `LAContext.interactionNotAllowed` do not stop that dialog: Security's own header says they apply only to the
/// data-protection keychain ("legacy keychain items will still activate UI if needed"). The switch that does is the
/// process-wide `SecKeychainSetUserInteractionAllowed(false)`, held off for exactly the length of each call here
/// (`withoutInteraction`), so a read the access list would ask about fails at once instead (CI run 38083908362, with a
/// control that did show the dialog).
///
/// Nor may one copy delete another copy's item (`errSecInvalidOwnerEdit`, the same run), so an item cannot be replaced
/// in place. A provider's key is therefore kept under its id as the account, or, when an item there belongs to another
/// copy, under `<id>.2`, `<id>.3`…: reading takes the newest item this copy can read; a provider with items but none
/// readable is `unreadable` (the app shows the server's "enter it again"); saving deletes what it may and adds the key
/// under the first free name; removing deletes what it may and leaves another copy's item alone. The context is passed
/// as well, for the data-protection keychain's sake.
public struct KeychainItems: Sendable {
    public let service: String

    public init(service: String) {
        self.service = service
    }

    /// What the service holds, by provider: the key this copy can read without a dialog, and the providers with items
    /// that it cannot.
    public struct Contents: Sendable, Equatable {
        public var readable: [String: String] = [:]
        public var unreadable: Set<String> = []
    }

    /// Why a write did not happen: the step and the Security status, never the secret.
    public struct Failure: Error, Sendable, Equatable, CustomStringConvertible {
        public let step: String
        public let status: OSStatus
        public var description: String { "keychain \(step): OSStatus \(status)" }
    }

    /// The provider an account keeps a key for, and its generation (1 for the bare id).
    static func parse(_ account: String) -> (provider: String, generation: Int) {
        let parts = account.split(separator: ".", maxSplits: 1).map(String.init)
        if parts.count == 2, let generation = Int(parts[1]), generation >= 2 { return (parts[0], generation) }
        return (account, 1)
    }

    static func account(_ provider: String, generation: Int) -> String {
        generation == 1 ? provider : "\(provider).\(generation)"
    }

    /// Every item of the service, read without a dialog.
    public func contents() -> Contents {
        Self.withoutInteraction {
            var contents = Contents()
            var newest: [String: Int] = [:]
            for account in accounts() {
                let (provider, generation) = Self.parse(account)
                var data: CFTypeRef?
                let one = query(account).merging([
                    kSecMatchLimit as String: kSecMatchLimitOne,
                    kSecReturnData as String: true,
                ]) { $1 }
                let status = SecItemCopyMatching(one as CFDictionary, &data)
                if status == errSecSuccess, let data = data as? Data,
                   let secret = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !secret.isEmpty {
                    if generation > newest[provider, default: 0] {
                        newest[provider] = generation
                        contents.readable[provider] = secret
                    }
                } else if status != errSecItemNotFound {
                    contents.unreadable.insert(provider)
                }
            }
            contents.unreadable.subtract(contents.readable.keys)
            return contents
        }
    }

    /// Keeps a provider's key: deletes the items this copy may delete, then adds the key under the first free name
    /// (another copy's item, which cannot be deleted, is left where it is).
    public func save(_ secret: String, account provider: String) throws(Failure) {
        let status: (step: String, code: OSStatus) = Self.withoutInteraction {
            var held = Set<Int>()
            for account in accounts() where Self.parse(account).provider == provider {
                let deleted = SecItemDelete(query(account) as CFDictionary)
                if deleted == errSecSuccess || deleted == errSecItemNotFound { continue }
                guard Self.belongsToAnother(deleted) else { return ("delete", deleted) }
                held.insert(Self.parse(account).generation)
            }
            let generation = (1...).first { !held.contains($0) } ?? 1
            var add = query(Self.account(provider, generation: generation))
            add[kSecValueData as String] = Data(secret.utf8)
            add[kSecAttrLabel as String] = service
            add.removeValue(forKey: kSecUseAuthenticationContext as String)
            return ("add", SecItemAdd(add as CFDictionary, nil))
        }
        guard status.code == errSecSuccess else { throw Failure(step: status.step, status: status.code) }
    }

    /// Deletes a provider's items this copy may delete; none there, or only another copy's, is not a failure.
    public func remove(account provider: String) throws(Failure) {
        let status: OSStatus = Self.withoutInteraction {
            for account in accounts() where Self.parse(account).provider == provider {
                let deleted = SecItemDelete(query(account) as CFDictionary)
                if deleted == errSecSuccess || deleted == errSecItemNotFound || Self.belongsToAnother(deleted) { continue }
                return deleted
            }
            return errSecSuccess
        }
        guard status == errSecSuccess else { throw Failure(step: "delete", status: status) }
    }

    /// A delete refused because the item is another copy's (its owner, or a dialog that is not allowed).
    static func belongsToAnother(_ status: OSStatus) -> Bool {
        status == errSecInvalidOwnerEdit || status == errSecInteractionNotAllowed || status == errSecAuthFailed
    }

    /// The accounts the service has items for (their attributes only: listing never needs the access list).
    private func accounts() -> Set<String> {
        var found: CFTypeRef?
        let list = query(nil).merging([
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]) { $1 }
        guard SecItemCopyMatching(list as CFDictionary, &found) == errSecSuccess,
              let items = found as? [[String: Any]] else { return [] }
        return Set(items.compactMap { $0[kSecAttrAccount as String] as? String })
    }

    private func query(_ account: String?) -> [String: Any] {
        let context = LAContext()
        context.interactionNotAllowed = true
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseAuthenticationContext as String: context,
        ]
        if let account { query[kSecAttrAccount as String] = account }
        return query
    }

    // MARK: No dialog

    private static let lock = NSLock()
    private typealias SetAllowed = @convention(c) (DarwinBoolean) -> OSStatus
    private typealias GetAllowed = @convention(c) (UnsafeMutablePointer<DarwinBoolean>) -> OSStatus

    /// `SecKeychainSetUserInteractionAllowed` and its getter, found at run time: they are still exported by
    /// Security.framework, but the macOS 26 SDK's headers no longer declare them.
    private static let switches: (set: SetAllowed, get: GetAllowed)? = {
        guard let security = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_NOW),
              let set = dlsym(security, "SecKeychainSetUserInteractionAllowed"),
              let get = dlsym(security, "SecKeychainGetUserInteractionAllowed") else { return nil }
        return (unsafeBitCast(set, to: SetAllowed.self), unsafeBitCast(get, to: GetAllowed.self))
    }()

    /// Whether the process-wide switch was found (the probe says so; without it nothing here is guaranteed not to ask).
    public static var canForbidDialogs: Bool { switches != nil }

    /// Runs `body` with the Keychain's user interaction turned off for this process, and puts it back as it was.
    /// Serialised, so two calls never interleave their switching.
    public static func withoutInteraction<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        guard let switches else { return body() }
        var was = DarwinBoolean(true)
        let read = switches.get(&was)
        _ = switches.set(false)
        defer { _ = switches.set(read == errSecSuccess ? was : true) }
        return body()
    }
}
