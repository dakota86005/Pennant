import Foundation
import Synchronization

/// Where the provider keys handed to the server come from. They travel on the sidecar's stdin, never in its
/// environment (SWIFTUI_REBUILD.md section 5.1).
public protocol KeySource: Sendable {
    /// The keys by provider id (`anthropic`, `openai`, …); a provider without a key is simply absent. Async: a
    /// Keychain read runs off the caller's actor, and the caller must not be blocked by it.
    func keys() async -> [String: String]
}

/// A key source the GM can change from Settings ▸ AI (N13): a key saved or removed, and the providers whose kept key
/// could not be read back (Settings shows the server's "enter it again" line beside them).
public protocol KeyStore: KeySource {
    func save(_ key: String, for provider: String) async throws(KeyStoreFailure)
    func remove(_ provider: String) async throws(KeyStoreFailure)
    func unreadable() async -> Set<String>
}

/// Why a key could not be kept or removed: the step and its status, for the log only. Never the key.
public struct KeyStoreFailure: Error, Sendable, Equatable, CustomStringConvertible {
    public let description: String
    public init(_ description: String) { self.description = description }
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

    /// - Parameter unreadable: providers to report as kept but unreadable (a test of the "enter it again" line).
    public init(_ values: [String: String] = [:], unreadable: Set<String> = []) {
        held = Mutex(values)
        lost = unreadable
    }

    public func keys() async -> [String: String] { held.withLock { $0 } }
    public func save(_ key: String, for provider: String) async throws(KeyStoreFailure) { held.withLock { $0[provider] = key } }
    public func remove(_ provider: String) async throws(KeyStoreFailure) { _ = held.withLock { $0.removeValue(forKey: provider) } }
    public func unreadable() async -> Set<String> { lost.subtracting(held.withLock { Set($0.keys) }) }
}

/// The Mac Keychain's generic passwords for this app, one item per provider, the account being the provider id
/// (SWIFTUI_REBUILD.md section 7.6; D-074). The service is named after the app's bundle id (`<bundle id>.apikeys`), so
/// the release app (`com.dakotawise.pennant.apikeys`, the name N3 read) and a development build
/// (`com.dakotawise.pennant.dev.apikeys`) never read each other's items. Every call runs on a detached task, never on the
/// caller's actor, and never shows a dialog (`KeychainItems`).
public struct KeychainKeyStore: KeyStore {
    /// The name N3 read, and the release app's own.
    public static let service = "com.dakotawise.pennant.apikeys"
    public let service: String

    public init(service: String = KeychainKeyStore.service) {
        self.service = service
    }

    /// The service for an app's bundle id; N3's name when there is none.
    public static func service(forBundleID id: String?) -> String {
        guard let id, !id.isEmpty else { return service }
        return "\(id).apikeys"
    }

    public func keys() async -> [String: String] {
        let items = KeychainItems(service: service)
        return await Task.detached(priority: .userInitiated) { items.contents().readable }.value
    }

    public func unreadable() async -> Set<String> {
        let items = KeychainItems(service: service)
        return await Task.detached(priority: .userInitiated) { items.contents().unreadable }.value
    }

    public func save(_ key: String, for provider: String) async throws(KeyStoreFailure) {
        let items = KeychainItems(service: service)
        let failure = await Task.detached(priority: .userInitiated) { () -> KeychainItems.Failure? in
            do throws(KeychainItems.Failure) { try items.save(key, account: provider); return nil } catch { return error }
        }.value
        if let failure { throw KeyStoreFailure(failure.description) }
    }

    public func remove(_ provider: String) async throws(KeyStoreFailure) {
        let items = KeychainItems(service: service)
        let failure = await Task.detached(priority: .userInitiated) { () -> KeychainItems.Failure? in
            do throws(KeychainItems.Failure) { try items.remove(account: provider); return nil } catch { return error }
        }.value
        if let failure { throw KeyStoreFailure(failure.description) }
    }
}
