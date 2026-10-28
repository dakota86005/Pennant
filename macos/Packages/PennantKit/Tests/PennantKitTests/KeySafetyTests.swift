import Foundation
import Security
import Testing
@testable import PennantKit

/// The app's server password and its stored keys (B-101): the token goes only to the server's own `/api/` paths, and
/// a new key is in place before the old one is deleted. Pure, so no Keychain is touched.
@Suite("Key and token safety")
struct KeySafetyTests {
    // MARK: The token stays on this server (MACKIT-12)

    @Test("a served path is followed only when it is this server's own /api/ path")
    func servedPathStaysHome() {
        let home = PennantClient.servedURL(path: "/api/logo/1?v=abc", port: 5000)
        #expect(home?.absoluteString == "http://127.0.0.1:5000/api/logo/1?v=abc")
        for path in [
            "https://evil.example/api/logo/1",
            "http://127.0.0.1:6000/api/logo/1",
            "//evil.example/api/logo/1",
            "/\\evil.example/api/logo/1",
            "api/logo/1",
            "/logo/1",
            "/api/../secret",
            "file:///etc/passwd",
            "",
        ] {
            #expect(PennantClient.servedURL(path: path, port: 5000) == nil, "followed \(path)")
        }
    }

    // MARK: Saving a key never loses the old one first (MACKIT-11)

    /// What a replacement did, in order.
    final class Log {
        var steps: [String] = []
    }

    private func items(_ accounts: String...) -> [KeychainItems.Listed] {
        accounts.map { KeychainItems.Listed(account: $0, modified: nil) }
    }

    @Test("the new key is added before any old item is deleted, under a name no item holds")
    func addsFirst() {
        let log = Log()
        let result = KeychainItems.replace(
            "anthropic", among: items("anthropic", "openai"), mayTry: { _ in true },
            add: { log.steps.append("add \($0)"); return errSecSuccess },
            delete: { log.steps.append("delete \($0)"); return errSecSuccess }
        )
        #expect(result.code == errSecSuccess)
        #expect(log.steps == ["add anthropic.2", "delete anthropic"])
    }

    @Test("a failed add deletes nothing: the old key stands")
    func failedAddKeepsOld() {
        let log = Log()
        let result = KeychainItems.replace(
            "anthropic", among: items("anthropic"), mayTry: { _ in true },
            add: { log.steps.append("add \($0)"); return errSecInteractionNotAllowed },
            delete: { log.steps.append("delete \($0)"); return errSecSuccess }
        )
        #expect(result == ("add", errSecInteractionNotAllowed))
        #expect(log.steps == ["add anthropic.2"])
    }

    @Test("another copy's item is left; an item this copy may not try is not touched")
    func othersLeft() {
        let log = Log()
        let result = KeychainItems.replace(
            "anthropic", among: items("anthropic", "anthropic.2", "anthropic.3"), mayTry: { $0 != "anthropic.3" },
            add: { log.steps.append("add \($0)"); return errSecSuccess },
            delete: { account in
                log.steps.append("delete \(account)")
                return account == "anthropic.2" ? errSecInvalidOwnerEdit : errSecSuccess
            }
        )
        #expect(result.code == errSecSuccess)
        #expect(log.steps == ["add anthropic.4", "delete anthropic", "delete anthropic.2"])
    }

    @Test("a delete refused for another reason is a failure, and the new key is kept")
    func refusedDelete() {
        let log = Log()
        let result = KeychainItems.replace(
            "openai", among: items("openai.2"), mayTry: { _ in true },
            add: { log.steps.append("add \($0)"); return errSecSuccess },
            delete: { log.steps.append("delete \($0)"); return errSecAuthFailed }
        )
        #expect(result == ("delete", errSecAuthFailed))
        #expect(log.steps == ["add openai", "delete openai.2"])
    }
}
