import Foundation
import Testing
@testable import PennantKit

/// N14 Stage B, D-076: the updater as Settings ▸ Updates and Check for Updates… see it. Sparkle is never linked here, so
/// nothing reaches the network.
@Suite("Updates")
@MainActor
struct UpdatesTests {
    static let release: [String: Any] = [
        "SUFeedURL": "https://github.com/dakota86005/Pennant/releases/latest/download/appcast.xml",
        "SUPublicEDKey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    ]

    @Test("only a feed over https with a public key starts an updater; a Debug build has neither")
    func feedConfigured() {
        #expect(Updates.feedConfigured(Self.release))
        #expect(!Updates.feedConfigured(nil))
        #expect(!Updates.feedConfigured([:]), "a Debug build's Info.plist")
        #expect(!Updates.feedConfigured(["SUFeedURL": Self.release["SUFeedURL"]!]), "a feed without the key")
        #expect(!Updates.feedConfigured(["SUPublicEDKey": Self.release["SUPublicEDKey"]!]), "a key without the feed")
        var plain = Self.release
        plain["SUFeedURL"] = "http://example.com/appcast.xml"
        #expect(!Updates.feedConfigured(plain), "a feed over plain http")
        var blank = Self.release
        blank["SUPublicEDKey"] = "  "
        #expect(!Updates.feedConfigured(blank))
    }

    @Test("a build without an updater never checks, and says so")
    func off() {
        let updates = Updates.off()
        #expect(updates.availability == .offInThisBuild)
        #expect(!updates.canCheck)
        #expect(!updates.automaticallyChecks)
        #expect(updates.lastCheck == nil)
        updates.setAutomaticallyChecks(true)
        updates.checkNow()
        #expect(!updates.automaticallyChecks)
        #expect(updates.lastCheck == nil)
    }

    @Test("consent first: automatic checks are off until turned on, and the switch reaches the updater")
    func automaticSwitch() {
        let driver = MemoryUpdater()
        let updates = Updates(driver: driver)
        #expect(updates.availability == .available)
        #expect(!updates.automaticallyChecks)
        updates.setAutomaticallyChecks(true)
        #expect(driver.automaticallyChecks)
        #expect(updates.automaticallyChecks)
        updates.setAutomaticallyChecks(false)
        #expect(!driver.automaticallyChecks)
    }

    @Test("Check for Updates… asks the updater once and shows the time of the check")
    func checkNow() {
        let when = Date(timeIntervalSince1970: 1_800_000_000)
        let driver = MemoryUpdater(now: { when })
        let updates = Updates(driver: driver)
        #expect(updates.canCheck)
        updates.checkNow()
        #expect(driver.checks == 1)
        #expect(updates.lastCheck == when)
    }

    @Test("no check starts while one is running")
    func busy() {
        let driver = MemoryUpdater()
        driver.canCheck = false
        let updates = Updates(driver: driver)
        updates.checkNow()
        #expect(driver.checks == 0)
        #expect(!updates.canCheck)
    }

    @Test("a change the updater makes by itself (its own question answered) is shown")
    func changedByTheUpdater() {
        let driver = MemoryUpdater()
        let updates = Updates(driver: driver)
        driver.automaticallyChecks = true
        #expect(updates.automaticallyChecks)
    }
}
