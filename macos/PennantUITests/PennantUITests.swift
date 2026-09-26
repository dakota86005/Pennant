import XCTest

/// Smoke flows on the real app, its bundled server and scratch data folders holding the synthetic league
/// (SWIFTUI_REBUILD.md section 8). The XCUITest runner is sandboxed and cannot create folders, so it writes nothing:
/// `macos/scripts/test.sh` prepares a folder per test under a scratch root (its data folder with the synthetic league,
/// a pretend OOTP save, and the save already chosen where the test wants one) and passes the root, through
/// `TEST_RUNNER_`, as `PENNANT_UI_SCRATCH`; the test hands its folder to the app in `launchEnvironment`. Without the root
/// the tests skip: they never launch the app on the real data folder. Screenshots are kept as attachments, which
/// `test.sh` extracts.
final class PennantUITests: XCTestCase {
    private var environment: [String: String] { ProcessInfo.processInfo.environment }
    private var scratch: URL!
    private var dataFolder: URL!

    /// The running test's method name (`testSetupFlowOnAScratchFolder`), the name of its prepared folder.
    private var methodName: String {
        // XCTest names a test "-[PennantUITests testSetupFlowOnAScratchFolder]"
        String(name.split(separator: " ").last?.dropLast() ?? Substring(name))
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard let root = environment["PENNANT_UI_SCRATCH"] else {
            throw XCTSkip("PENNANT_UI_SCRATCH is not set: the UI tests run only on scratch data folders (macos/scripts/test.sh)")
        }
        scratch = URL(fileURLWithPath: root).appending(path: methodName, directoryHint: .isDirectory)
        dataFolder = scratch.appending(path: "data", directoryHint: .isDirectory)
        guard FileManager.default.fileExists(atPath: dataFolder.appending(path: "league.db").path(percentEncoded: false)) else {
            XCTFail("macos/scripts/test.sh prepares \(scratch.path(percentEncoded: false)); add \(methodName) to its prepare_ui_test list")
            return
        }
    }

    // MARK: Helpers

    /// The pretend OOTP save `test.sh` put in the test's folder: the `.lg` folder with an export of one small table.
    private var save: URL {
        scratch.appending(path: "saves/Synthetic League.lg", directoryHint: .isDirectory)
    }

    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PENNANT_DEV_DATA_DIR"] = dataFolder.path(percentEncoded: false)
        app.launchEnvironment["PENNANT_DEV_LOG_DIR"] = scratch.appending(path: "logs").path(percentEncoded: false)
        // A fresh window each time: no restored route from an earlier run
        app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        return app
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// Waits for the main window's shell (the sidebar) or a server problem; fails on a problem.
    @MainActor
    private func waitForShell(_ app: XCUIApplication) {
        let sidebar = element(app, "sidebar")
        let problem = element(app, "server.problem")
        let deadline = Date.now.addingTimeInterval(60)
        while !sidebar.exists && !problem.exists && Date.now < deadline {
            _ = sidebar.waitForExistence(timeout: 1)
        }
        XCTAssertFalse(problem.exists, "the server did not start; see \(scratch.path)/logs/server.log")
        XCTAssertTrue(sidebar.exists)
    }

    @MainActor
    private func keep(_ screenshot: XCUIScreenshot, named name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The accessibility audit, with every issue it finds named: its kind, what it says and the element, kept as a
    /// text attachment and in the failure, so a finding says where it is.
    ///
    /// One kind is set aside, and listed in the attachment: "no description" on a nameless, id-less group that spans
    /// a window's full height (the window's and the split view's own column containers, which SwiftUI's hosting views
    /// draw and no SwiftUI modifier reaches; labelling a SwiftUI container above them made the sidebar's rows stop
    /// scrolling into view for a click), and on the Touch Bar the system draws. Anything else fails the test.
    @MainActor
    private func audit(_ app: XCUIApplication) throws {
        var issues: [String] = []
        var setAside: [String] = []
        let windows = app.windows.allElementsBoundByIndex.map(\.frame)
        try app.performAccessibilityAudit { issue in
            let element = issue.element
            let line = "\(issue.auditType): \(issue.compactDescription): "
                + (element.map { "type \($0.elementType.rawValue) id='\($0.identifier)' label='\($0.label)' frame=\($0.frame)" } ?? "no element")
            let structural = issue.auditType == .sufficientElementDescription && element.map { e in
                e.elementType == .touchBar || (e.elementType == .group && e.identifier.isEmpty && e.label.isEmpty
                    && windows.contains { $0.minY == e.frame.minY && $0.height == e.frame.height })
            } == true
            if structural { setAside.append(line) } else { issues.append(line) }
            return true
        }
        let attachment = XCTAttachment(string: (["Findings:"] + issues + ["", "Set aside (the system's own containers):"] + setAside).joined(separator: "\n"))
        attachment.name = "accessibility-audit"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(issues, [], "the accessibility audit found issues")
    }

    @MainActor
    private func quitCleanly(_ app: XCUIApplication) {
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 20))
        XCTAssertFalse(FileManager.default.fileExists(atPath: dataFolder.appending(path: "server.lock").path))
    }

    // MARK: Flows

    @MainActor
    func testStartsTheServerAndQuitsCleanly() throws {
        let app = launch()
        waitForShell(app)
        keep(app.windows.firstMatch.screenshot(), named: "main-window")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dataFolder.appending(path: "server.lock").path))
        quitCleanly(app)
    }

    /// First run: the server has no save, so Setup opens by itself. A folder is picked by path, the import runs, and
    /// a club is saved; Setup closes and the main window shows the club.
    @MainActor
    func testSetupFlowOnAScratchFolder() throws {
        let app = launch()
        let setup = element(app, "setup")
        XCTAssertTrue(setup.waitForExistence(timeout: 60), "Setup did not open for a server with no save")
        keep(app.windows.firstMatch.screenshot(), named: "setup-find-save")

        let path = element(app, "setup.folderPath")
        path.click()
        path.typeText(save.path(percentEncoded: false))
        element(app, "setup.useFolder").click()

        let clubs = element(app, "setup.clubs")
        XCTAssertTrue(clubs.waitForExistence(timeout: 60), "the import did not reach the club step")
        keep(app.windows.firstMatch.screenshot(), named: "setup-pick-club")
        element(app, "setup.saveClub").click()

        XCTAssertTrue(setup.waitForNonExistence(timeout: 20), "Setup did not close after the club was saved")
        waitForShell(app)
        XCTAssertTrue(element(app, "club.card").waitForExistence(timeout: 10))
        keep(app.windows.firstMatch.screenshot(), named: "main-window-after-setup")
        quitCleanly(app)
    }

    /// Every department by ⌘1 to ⌘9 and through the sidebar, Back and Forward, the inspector, Settings' tabs, and an
    /// accessibility audit.
    @MainActor
    func testDepartmentsInspectorAndSettings() throws {
        let app = launch()
        waitForShell(app)

        let departments: [(key: String, id: String, first: String, last: String)] = [
            ("1", "frontOffice", "morningReport", "briefing"),
            ("2", "majorLeague", "report", "seasonTrends"),
            ("3", "farm", "report", "decision"),
            ("4", "scouting", "draftBoard", "playerSearch"),
            ("5", "trades", "tradeDesk", "tradeDesk"),
            ("6", "finance", "report", "horizonBoard"),
            ("7", "medical", "report", "injuryReport"),
            ("8", "league", "wire", "franchiseHistory"),
            ("9", "philosophy", "organizationalPhilosophy", "coachingStaff"),
        ]
        for department in departments {
            app.typeKey(department.key, modifierFlags: .command)
            XCTAssertTrue(element(app, "detail.\(department.id).\(department.first)").waitForExistence(timeout: 5),
                          "⌘\(department.key) did not open \(department.id)")
            let row = element(app, "sidebar.\(department.id).\(department.last)")
            XCTAssertTrue(row.waitForExistence(timeout: 5))
            row.click()
            XCTAssertTrue(element(app, "detail.\(department.id).\(department.last)").waitForExistence(timeout: 5))
            keep(app.windows.firstMatch.screenshot(), named: "department-\(department.id)")
        }

        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.philosophy.organizationalPhilosophy").waitForExistence(timeout: 5))
        app.typeKey("]", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.philosophy.coachingStaff").waitForExistence(timeout: 5))

        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertTrue(element(app, "inspector").waitForExistence(timeout: 5))
        keep(app.windows.firstMatch.screenshot(), named: "inspector-open")
        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertTrue(element(app, "inspector").waitForNonExistence(timeout: 5))

        // Audit the window at rest: every department folded and the sidebar at its top, so the whole list fits and no
        // row is caught half under the toolbar's glass or cut by the window's edge (a half-shown line reads as low
        // contrast; every macOS sidebar scrolls that way)
        let sidebar = app.outlines["sidebar"].firstMatch
        for triangle in sidebar.disclosureTriangles.allElementsBoundByIndex where (triangle.value as? Int) == 1 {
            triangle.click()
        }
        sidebar.scroll(byDeltaX: 0, deltaY: 2000)
        try audit(app)

        app.typeKey(",", modifierFlags: .command)
        for (tab, identifier) in [("General", "settings.general"), ("Appearance", "settings.appearance"), ("AI", "settings.ai")] {
            let button = app.toolbars.buttons[tab].firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 5), "no \(tab) tab")
            button.click()
            XCTAssertTrue(element(app, identifier).waitForExistence(timeout: 5))
            keep(app.windows.firstMatch.screenshot(), named: "settings-\(tab.lowercased())")
        }
        app.typeKey("w", modifierFlags: .command)
        quitCleanly(app)
    }
}
