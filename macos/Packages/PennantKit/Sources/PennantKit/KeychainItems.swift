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
/// copy, under `<id>.2`, `<id>.3`…. Reading takes the item this copy can read (its own; of several, the most recently
/// modified); a provider with items but none readable is `unreadable` (the app shows the server's "enter it again"), and
/// one whose readable key is older than another copy's item is `newerElsewhere` (the server's "a newer key elsewhere";
/// review N13B, L2). Saving deletes what it may and adds the key under the first free name; removing deletes what it may
/// and says when another copy's item is left. Only `errSecInvalidOwnerEdit` is read as "another copy's": any other refusal
/// is a failure (review N13B, M4). The context is passed as well, for the data-protection keychain's sake.
///
/// How items pile up: each copy that cannot delete the others' items adds one generation beside them. On a development
/// Mac every ad hoc re-signed build is a new copy, so a key saved from several builds leaves one item per build (Keychain
/// Access, or Remove in each build, clears them). A release update keeps the stable Developer ID designated requirement
/// the items' access lists trust, so each update reads, replaces and removes the items the one before it kept: nothing
/// piles up there.
///
/// Every other Keychain use in the process must go through `exclusively` (or this type): the switch is process-wide, and
/// a legacy Keychain call made by anything else while it is off would fail as if a dialog were needed (review N13B, L3;
/// SWIFTUI_REBUILD.md "As built at N13, Stage B"). N14's updater and anything else that touches the Keychain take that
/// lock first.
public struct KeychainItems: Sendable {
    public let service: String
    /// Whether the switch that forbids dialogs may be used: false only in a test standing in for a system where it is gone.
    let switchFound: Bool

    public init(service: String) {
        self.init(service: service, switchFound: Self.canForbidDialogs)
    }

    init(service: String, switchFound: Bool) {
        self.service = service
        self.switchFound = switchFound && Self.canForbidDialogs
    }

    /// What the service holds, by provider: the key this copy can read without a dialog, the providers with items that
    /// it cannot, and those whose readable key is older than an item another copy kept.
    public struct Contents: Sendable, Equatable {
        public var readable: [String: String] = [:]
        public var unreadable: Set<String> = []
        public var newerElsewhere: Set<String> = []
    }

    /// What Remove did: every item went, or another copy's item, which this copy may not delete, is left.
    public enum Removal: Sendable, Equatable {
        case removed
        case anotherCopysLeft
    }

    /// Why a write did not happen: the step and the Security status, never the secret. For the log and a help tag only.
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

    /// One item as listed (its attributes only).
    struct Listed: Sendable, Equatable {
        var account: String
        var modified: Date?
    }

    /// What reading one item gave.
    enum Reading: Sendable, Equatable {
        case secret(String)
        /// It is there, but this copy may not read it without a dialog (or may not try: no switch).
        case refused
        /// Gone since it was listed.
        case gone
    }

    /// The service's standing from its items and what reading each gave (pure, so it is tested without a Keychain).
    static func standing(of items: [Listed], read: (String) -> Reading) -> Contents {
        var mine: [String: (modified: Date?, generation: Int, secret: String)] = [:]
        var refused = Set<String>()
        var othersNewest: [String: Date] = [:]
        for item in items {
            let (provider, generation) = parse(item.account)
            switch read(item.account) {
            case .secret(let secret):
                if let held = mine[provider], !isLater((item.modified, generation), than: (held.modified, held.generation)) { continue }
                mine[provider] = (item.modified, generation, secret)
            case .refused:
                refused.insert(provider)
                if let modified = item.modified, modified > othersNewest[provider] ?? .distantPast { othersNewest[provider] = modified }
            case .gone:
                continue
            }
        }
        var contents = Contents()
        contents.readable = mine.mapValues(\.secret)
        contents.unreadable = refused.subtracting(mine.keys)
        // Newer only when both dates are known and another copy's is strictly later (the legacy keychain keeps seconds)
        contents.newerElsewhere = Set(mine.compactMap { provider, held in
            guard let own = held.modified, let other = othersNewest[provider], other > own else { return nil }
            return provider
        })
        return contents
    }

    /// Whether one readable item is later than another: by modification date when both are known, else by generation.
    private static func isLater(_ one: (Date?, Int), than other: (Date?, Int)) -> Bool {
        if let a = one.0, let b = other.0, a != b { return a > b }
        return one.1 > other.1
    }

    /// Every item of the service, read without a dialog. With no switch, only an item this process added itself (which
    /// never asks) is read; every other one is reported unreadable without being tried (review N13B, M3).
    public func contents() -> Contents {
        Self.withoutInteraction(switchFound: switchFound) { forbidden in
            Self.standing(of: listed()) { account in
                guard Self.mayTry(account, service: service, dialogsForbidden: forbidden) else { return .refused }
                var data: CFTypeRef?
                let one = query(account).merging([
                    kSecMatchLimit as String: kSecMatchLimitOne,
                    kSecReturnData as String: true,
                ]) { $1 }
                let status = SecItemCopyMatching(one as CFDictionary, &data)
                if status == errSecItemNotFound { return .gone }
                guard status == errSecSuccess, let data = data as? Data,
                      let secret = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !secret.isEmpty else { return .refused }
                return .secret(secret)
            }
        }
    }

    /// Keeps a provider's key: deletes the items this copy may delete, then adds the key under the first free name
    /// (another copy's item, which cannot be deleted, is left where it is). With no switch, nothing but an item this
    /// process added is deleted, and the key is added under a free name: adding a new item never asks about access (it
    /// is this copy's own), though the system could still ask to unlock a locked login keychain.
    public func save(_ secret: String, account provider: String) throws(Failure) {
        let status: (step: String, code: OSStatus) = Self.withoutInteraction(switchFound: switchFound) { forbidden in
            var held = Set<Int>()
            for item in listed() where Self.parse(item.account).provider == provider {
                let generation = Self.parse(item.account).generation
                guard Self.mayTry(item.account, service: service, dialogsForbidden: forbidden) else { held.insert(generation); continue }
                let deleted = SecItemDelete(query(item.account) as CFDictionary)
                if deleted == errSecSuccess || deleted == errSecItemNotFound {
                    Self.forget(service, item.account)
                    continue
                }
                guard Self.belongsToAnother(deleted) else { return ("delete", deleted) }
                held.insert(generation)
            }
            let account = Self.account(provider, generation: (1...).first { !held.contains($0) } ?? 1)
            var add = query(account)
            add[kSecValueData as String] = Data(secret.utf8)
            add[kSecAttrLabel as String] = service
            add.removeValue(forKey: kSecUseAuthenticationContext as String)
            let added = SecItemAdd(add as CFDictionary, nil)
            if added == errSecSuccess, !forbidden { Self.remember(service, account) }
            return ("add", added)
        }
        guard status.code == errSecSuccess else { throw Failure(step: status.step, status: status.code) }
    }

    /// Deletes a provider's items this copy may delete; none there is not a failure, and another copy's item left is
    /// said (`anotherCopysLeft`). Any other refusal is a failure: the key may still be kept. With no switch, an item
    /// this process did not add is not touched, and is a failure.
    @discardableResult
    public func remove(account provider: String) throws(Failure) -> Removal {
        let outcome: Result<Removal, Failure> = Self.withoutInteraction(switchFound: switchFound) { forbidden in
            var left = false
            var untried = false
            for item in listed() where Self.parse(item.account).provider == provider {
                guard Self.mayTry(item.account, service: service, dialogsForbidden: forbidden) else { untried = true; continue }
                let deleted = SecItemDelete(query(item.account) as CFDictionary)
                if deleted == errSecSuccess || deleted == errSecItemNotFound {
                    Self.forget(service, item.account)
                    continue
                }
                guard Self.belongsToAnother(deleted) else { return .failure(Failure(step: "delete", status: deleted)) }
                left = true
            }
            if untried { return .failure(Failure(step: "delete without the dialog switch", status: errSecInteractionNotAllowed)) }
            return .success(left ? .anotherCopysLeft : .removed)
        }
        return try outcome.get()
    }

    /// A delete refused because the item is another copy's: only its owner may remove it. A dialog not allowed, or an
    /// authorisation that failed, is not that: the item may be this copy's, so it is a failure (review N13B, M4).
    static func belongsToAnother(_ status: OSStatus) -> Bool {
        status == errSecInvalidOwnerEdit
    }

    /// The service's items, by account, with when each was last modified (their attributes only: listing never needs
    /// the access list, so it never asks).
    private func listed() -> [Listed] {
        var found: CFTypeRef?
        let list = query(nil).merging([
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]) { $1 }
        guard SecItemCopyMatching(list as CFDictionary, &found) == errSecSuccess,
              let items = found as? [[String: Any]] else { return [] }
        var seen = Set<String>()
        return items.compactMap { attributes in
            guard let account = attributes[kSecAttrAccount as String] as? String, seen.insert(account).inserted else { return nil }
            return Listed(account: account, modified: attributes[kSecAttrModificationDate as String] as? Date)
        }
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

    /// Runs `body` with the Keychain's user interaction turned off for this process, and puts it back as it was; `body`
    /// is told whether dialogs are forbidden (false when the switch is missing, and nothing is to be tried that could
    /// ask). Serialised with every other Keychain use (`exclusively`), so two calls never interleave their switching.
    static func withoutInteraction<T>(switchFound: Bool = true, _ body: (_ dialogsForbidden: Bool) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        guard switchFound, let switches else { return body(false) }
        var was = DarwinBoolean(true)
        let read = switches.get(&was)
        _ = switches.set(false)
        defer { _ = switches.set(read == errSecSuccess ? was : true) }
        return body(true)
    }

    /// Runs any other Keychain use in the process (N14's updater, a credential store) under the same lock, so it never
    /// runs while the switch is off and fails as if it needed a dialog. Not re-entrant: never call it from inside a call
    /// of this type.
    public static func exclusively<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    // MARK: Items this process added

    /// The items this process added itself, by service and account: with no switch, the only ones it reads or deletes,
    /// since an item a process created never asks it anything. Guarded by `lock`.
    nonisolated(unsafe) private static var added = Set<String>()

    /// Whether an item may be read or deleted: always while dialogs are forbidden; with no switch, only one this process
    /// added (review N13B, M3).
    static func mayTry(_ account: String, service: String, dialogsForbidden: Bool) -> Bool {
        dialogsForbidden || addedHere(service, account)
    }

    private static func addedHere(_ service: String, _ account: String) -> Bool { added.contains("\(service)\u{0}\(account)") }
    private static func remember(_ service: String, _ account: String) { added.insert("\(service)\u{0}\(account)") }
    private static func forget(_ service: String, _ account: String) { added.remove("\(service)\u{0}\(account)") }
}
