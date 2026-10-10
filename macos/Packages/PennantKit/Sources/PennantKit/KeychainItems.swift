import Darwin
import Foundation
import LocalAuthentication
import Security

// Self-contained on purpose (Foundation, Security, LocalAuthentication only): `macos/scripts/keychain-no-prompt.sh`
// compiles this file with a small probe on CI to prove, with re-signed copies, that nothing here shows a dialog.

/// The generic passwords of one Keychain service, one per account (a provider id), read and written without ever
/// asking the person at the Mac anything (N13, D-074).
///
/// The items live in the login keychain (file-based): the data-protection keychain needs an application-identifier
/// entitlement, so a provisioning profile, which a Developer ID app does not have by default. On a file-based keychain
/// an item's access list trusts the app that created it; another app (a rebuilt development copy, a differently signed
/// one) reading it would make the system ask the person to allow it. `kSecUseAuthenticationUI` and
/// `LAContext.interactionNotAllowed` do not stop that dialog: Security's own header says they apply only to the
/// data-protection keychain ("legacy keychain items will still activate UI if needed"). The switch that does is the
/// process-wide `SecKeychainSetUserInteractionAllowed(false)`, held off for exactly the length of each call here
/// (`withoutInteraction`), so a read the access list would ask about fails at once with `errSecInteractionNotAllowed`
/// instead; that item is reported `unreadable`, and saving the key again replaces it (delete, then add) with one this
/// copy of the app owns. The context is passed as well, for the data-protection keychain's sake.
public struct KeychainItems: Sendable {
    public let service: String

    public init(service: String) {
        self.service = service
    }

    /// What the service holds: each account's secret that could be read without a dialog, and the accounts whose item
    /// is there but could not be.
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

    /// Every item of the service, read without a dialog.
    public func contents() -> Contents {
        Self.withoutInteraction {
            var contents = Contents()
            var found: CFTypeRef?
            let list = query(nil).merging([
                kSecMatchLimit as String: kSecMatchLimitAll,
                kSecReturnAttributes as String: true,
            ]) { $1 }
            guard SecItemCopyMatching(list as CFDictionary, &found) == errSecSuccess,
                  let items = found as? [[String: Any]] else { return contents }
            for account in Set(items.compactMap({ $0[kSecAttrAccount as String] as? String })) {
                var data: CFTypeRef?
                let one = query(account).merging([
                    kSecMatchLimit as String: kSecMatchLimitOne,
                    kSecReturnData as String: true,
                ]) { $1 }
                let status = SecItemCopyMatching(one as CFDictionary, &data)
                if status == errSecSuccess, let data = data as? Data,
                   let secret = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !secret.isEmpty {
                    contents.readable[account] = secret
                } else if status != errSecItemNotFound {
                    contents.unreadable.insert(account)
                }
            }
            return contents
        }
    }

    /// Keeps a secret for an account: any item already there is deleted first (one this copy cannot read is replaced
    /// by one it owns), then the new one added.
    public func save(_ secret: String, account: String) throws(Failure) {
        let status: (step: String, code: OSStatus) = Self.withoutInteraction {
            let deleted = SecItemDelete(query(account) as CFDictionary)
            guard deleted == errSecSuccess || deleted == errSecItemNotFound else { return ("delete", deleted) }
            var add = query(account)
            add[kSecValueData as String] = Data(secret.utf8)
            add[kSecAttrLabel as String] = service
            add.removeValue(forKey: kSecUseAuthenticationContext as String)
            return ("add", SecItemAdd(add as CFDictionary, nil))
        }
        guard status.code == errSecSuccess else { throw Failure(step: status.step, status: status.code) }
    }

    /// Deletes an account's item; none there is not a failure.
    public func remove(account: String) throws(Failure) {
        let status = Self.withoutInteraction { SecItemDelete(query(account) as CFDictionary) }
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(step: "delete", status: status) }
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
