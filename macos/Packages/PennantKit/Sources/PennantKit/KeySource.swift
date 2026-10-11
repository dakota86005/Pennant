import Foundation
import Synchronization

/// Where the provider keys handed to the server come from. They travel on the sidecar's stdin, never in its
/// environment (SWIFTUI_REBUILD.md section 5.1).
public protocol KeySource: Sendable {
    /// The keys by provider id (`anthropic`, `openai`, …); a provider without a key is simply absent. Async: a
    /// Keychain read runs off the caller's actor, and the caller must not be blocked by it.
    func keys() async -> [String: String]
}

/// A key source the GM can change from Settings ▸ AI (N13): a key saved or removed, and where each provider's kept items
/// stand (Settings shows the server's line for each).
public protocol KeyStore: KeySource {
    func save(_ key: String, for provider: String) async throws(KeyStoreFailure)
    func remove(_ provider: String) async throws(KeyStoreFailure)
    func standing() async -> KeyStanding
}

/// Where each provider's kept items stand, beyond the keys read (Settings, N13): which served line goes beside it.
public struct KeyStanding: Sendable, Equatable {
    /// A key is kept, but this copy may not read it without asking: the served "enter it again" (`reenter`).
    public var unreadable: Set<String>
    /// The GM removed the key here, and only another copy's item, which this copy may not delete, is left: the served
    /// "another copy kept a key here" (`otherCopy`, review N13B M4), never "enter it again".
    public var anotherCopys: Set<String>
    /// This copy reads its own key, but another copy saved one more recently: the served `newerElsewhere` (review N13B L2).
    public var newerElsewhere: Set<String>

    public init(unreadable: Set<String> = [], anotherCopys: Set<String> = [], newerElsewhere: Set<String> = []) {
        self.unreadable = unreadable
        self.anotherCopys = anotherCopys
        self.newerElsewhere = newerElsewhere
    }
}

/// Why a key could not be kept or removed: the step and its status, for the log and a help tag only (the screen says
/// the server's sentence). Never the key.
public struct KeyStoreFailure: Error, Sendable, Equatable, CustomStringConvertible {
    public let description: String
    public init(_ description: String) { self.description = description }
}

/// What became of a key change once the Keychain had it (review N13B, L6).
public enum KeyHandOver: Sendable, Equatable {
    /// The running server has the new set (or none is running: it reads the keys when it starts).
    case handedOver
    /// The Keychain has the change, but the running server could not be told: it takes effect at the next start. The
    /// detail is for the log and a help tag (an error's domain and code), never a key.
    case failed(detail: String)

    /// The failure's detail, or nil when the server was told.
    public var failure: String? {
        if case .failed(let detail) = self { detail } else { nil }
    }
}

/// No keys: the app works without any AI provider (D-001).
public struct NoKeys: KeySource {
    public init() {}
    public func keys() async -> [String: String] { [:] }
}

/// Keys given directly (tests, previews).
public struct FixedKeys: KeySource {
    public let values: [String: String]
    public init(_ values: [String: String]) { self.values = values }
    public func keys() async -> [String: String] { values }
}

/// Keys kept in memory only, for tests, previews and the UI tests (`-PennantTestKeys memory`): never the Keychain.
public final class MemoryKeyStore: KeyStore {
    private let held: Mutex<[String: String]>
    private let lost: Set<String>
    private let setAside = Mutex<Set<String>>([])

    /// - Parameter unreadable: providers to report as kept by another copy, unreadable here (a test of the "enter it
    ///   again" line, and of "another copy kept a key here" once removed).
    public init(_ values: [String: String] = [:], unreadable: Set<String> = []) {
        held = Mutex(values)
        lost = unreadable
    }

    public func keys() async -> [String: String] { held.withLock { $0 } }

    public func save(_ key: String, for provider: String) async throws(KeyStoreFailure) {
        held.withLock { $0[provider] = key }
        _ = setAside.withLock { $0.remove(provider) }
    }

    public func remove(_ provider: String) async throws(KeyStoreFailure) {
        _ = held.withLock { $0.removeValue(forKey: provider) }
        if lost.contains(provider) { _ = setAside.withLock { $0.insert(provider) } }
    }

    public func standing() async -> KeyStanding {
        let readable = held.withLock { Set($0.keys) }
        let aside = setAside.withLock { $0 }
        let unread = lost.subtracting(readable)
        return KeyStanding(unreadable: unread.subtracting(aside), anotherCopys: unread.intersection(aside))
    }
}

/// The Mac Keychain's generic passwords for this app, one item per provider, the account being the provider id
/// (SWIFTUI_REBUILD.md section 7.6; D-074). The service is named after the app's bundle id (`<bundle id>.apikeys`), so
/// the release app (`com.dakotawise.pennant.apikeys`, the name N3 read) and a development build
/// (`com.dakotawise.pennant.dev.apikeys`) never read each other's items. Every call runs on a detached task, never on the
/// caller's actor, and never shows a dialog (`KeychainItems`). A provider the GM removed while another copy's item is
/// left is remembered in the app's defaults (`setAsideKey`), so Settings says "another copy kept a key here" rather than
/// "enter it again"; saving a key forgets it.
public struct KeychainKeyStore: KeyStore {
    /// The name N3 read, and the release app's own.
    public static let service = "com.dakotawise.pennant.apikeys"
    public let service: String
    /// The defaults suite the removed providers are remembered in; nil for the app's own defaults.
    let suite: String?

    public init(service: String = KeychainKeyStore.service, suite: String? = nil) {
        self.service = service
        self.suite = suite
    }

    /// The service for an app's bundle id; N3's name when there is none.
    public static func service(forBundleID id: String?) -> String {
        guard let id, !id.isEmpty else { return service }
        return "\(id).apikeys"
    }

    /// The defaults key for the providers removed beside another copy's item, per service.
    var setAsideKey: String { "PennantKeysSetAside.\(service)" }

    private var defaults: UserDefaults { suite.flatMap(UserDefaults.init(suiteName:)) ?? .standard }

    private func setAside() -> Set<String> { Set(defaults.stringArray(forKey: setAsideKey) ?? []) }

    private func keep(setAside providers: Set<String>) {
        if providers.isEmpty { defaults.removeObject(forKey: setAsideKey) } else { defaults.set(providers.sorted(), forKey: setAsideKey) }
    }

    public func keys() async -> [String: String] {
        let items = KeychainItems(service: service)
        return await Task.detached(priority: .userInitiated) { items.contents().readable }.value
    }

    public func standing() async -> KeyStanding {
        let items = KeychainItems(service: service)
        let contents = await Task.detached(priority: .userInitiated) { items.contents() }.value
        let (standing, aside) = Self.standing(contents, setAside: setAside())
        keep(setAside: aside)
        return standing
    }

    /// The standing from what the Keychain holds and the providers removed beside another copy's item, and which of
    /// those are still to be remembered: one with no unreadable item left (nothing of another copy's, or a key of this
    /// copy's own again) is forgotten.
    static func standing(_ contents: KeychainItems.Contents, setAside: Set<String>) -> (KeyStanding, Set<String>) {
        let aside = setAside.intersection(contents.unreadable)
        let standing = KeyStanding(
            unreadable: contents.unreadable.subtracting(aside), anotherCopys: aside, newerElsewhere: contents.newerElsewhere
        )
        return (standing, aside)
    }

    public func save(_ key: String, for provider: String) async throws(KeyStoreFailure) {
        let items = KeychainItems(service: service)
        let failure = await Task.detached(priority: .userInitiated) { () -> KeychainItems.Failure? in
            do throws(KeychainItems.Failure) { try items.save(key, account: provider); return nil } catch { return error }
        }.value
        if let failure { throw KeyStoreFailure(failure.description) }
        keep(setAside: setAside().subtracting([provider]))
    }

    public func remove(_ provider: String) async throws(KeyStoreFailure) {
        let items = KeychainItems(service: service)
        let outcome = await Task.detached(priority: .userInitiated) { () -> Result<KeychainItems.Removal, KeychainItems.Failure> in
            do throws(KeychainItems.Failure) { return .success(try items.remove(account: provider)) } catch { return .failure(error) }
        }.value
        switch outcome {
        case .success(.anotherCopysLeft): keep(setAside: setAside().union([provider]))
        case .success(.removed): keep(setAside: setAside().subtracting([provider]))
        case .failure(let failure): throw KeyStoreFailure(failure.description)
        }
    }
}
