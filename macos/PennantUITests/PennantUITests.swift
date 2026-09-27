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

    /// The pretend OOTP save `test.sh` put in the test's folder: the `.lg` folder with the synthetic league's export.
    private var save: URL {
        scratch.appending(path: "saves/Synthetic League.lg", directoryHint: .isDirectory)
    }

    @MainActor
    private func launch(arguments: [String] = [], environment: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PENNANT_DEV_DATA_DIR"] = dataFolder.path(percentEncoded: false)
        app.launchEnvironment["PENNANT_DEV_LOG_DIR"] = scratch.appending(path: "logs").path(percentEncoded: false)
        // The app's own caches (the Morning Report kept across launches) in the test's folder, never the Mac's
        app.launchEnvironment["PENNANT_DEV_CACHES_DIR"] = scratch.appending(path: "caches").path(percentEncoded: false)
        for (name, value) in environment { app.launchEnvironment[name] = value }
        // A fresh window each time: no restored route from an earlier run
        app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"] + arguments
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
    private func audit(_ app: XCUIApplication, named name: String = "accessibility-audit") throws {
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
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(issues, [], "the accessibility audit found issues")
    }

    /// The sidebar at its top, as a window opens: its departments stay unfolded (the audit reads every row there is).
    @MainActor
    private func sidebarAtTop(_ app: XCUIApplication) {
        app.outlines["sidebar"].firstMatch.scroll(byDeltaX: 0, deltaY: 2000)
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
        // The Morning Report shows the served desk and cards, and a department's report its served anatomy
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 20), "the Morning Report's desk did not load")
        // The served desk and cards pass the audit too, with the sidebar's departments unfolded
        sidebarAtTop(app)
        keep(app.windows.firstMatch.screenshot(), named: "morning-report")
        try audit(app, named: "accessibility-audit-morning-report")
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "report.content").waitForExistence(timeout: 20), "Major League Ops' report did not load")
        keep(app.windows.firstMatch.screenshot(), named: "major-league-report")

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

        // Audit the window with every department unfolded (the loop above opened each), the sidebar at its top
        sidebarAtTop(app)
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

    // MARK: The glass shell (N5)

    /// The Morning Report and Major League Ops' report under the club's masthead, each audited with the sidebar
    /// unfolded, kept as `glass-<look>-morning-report` and `glass-<look>-report`.
    @MainActor
    private func shellFlow(_ app: XCUIApplication, look: String) throws {
        waitForShell(app)
        // Major League Ops first, so its twelve views are unfolded too: the sidebar runs past the window's bottom edge
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "report.content").waitForExistence(timeout: 20), "Major League Ops' report did not load")
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 20), "the Morning Report's desk did not load")
        XCTAssertTrue(element(app, "masthead").waitForExistence(timeout: 5), "no masthead on the Morning Report")
        sidebarAtTop(app)
        keep(app.windows.firstMatch.screenshot(), named: "glass-\(look)-morning-report")
        try audit(app, named: "accessibility-audit-glass-\(look)-morning-report")
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "masthead").waitForExistence(timeout: 20), "no masthead on Major League Ops' report")
        keep(app.windows.firstMatch.screenshot(), named: "glass-\(look)-report")
        try audit(app, named: "accessibility-audit-glass-\(look)-report")
    }

    /// The club's own colours, light (the save's served appearance), then with Increase Contrast.
    @MainActor
    func testGlassShellClubColorsLight() throws {
        var app = launch()
        try shellFlow(app, look: "club-colors-light")
        // The floating control opens the whole desk
        app.typeKey("1", modifierFlags: .command)
        let wholeDesk = element(app, "morningReport.wholeDesk")
        XCTAssertTrue(wholeDesk.waitForExistence(timeout: 10))
        wholeDesk.click()
        XCTAssertTrue(element(app, "detail.frontOffice.report").waitForExistence(timeout: 10), "Whole Desk did not open the Front Office's report")
        quitCleanly(app)
        app = launch(arguments: ["-PennantDebugAppearance", "increasedContrastLight"])
        try shellFlow(app, look: "club-colors-light-increased-contrast")
        quitCleanly(app)
    }

    /// The club's own colours in dark (settings.json's `theme`), then with Increase Contrast.
    @MainActor
    func testGlassShellClubColorsDark() throws {
        var app = launch()
        try shellFlow(app, look: "club-colors-dark")
        quitCleanly(app)
        app = launch(arguments: ["-PennantDebugAppearance", "increasedContrastDark"])
        try shellFlow(app, look: "club-colors-dark-increased-contrast")
        quitCleanly(app)
    }

    /// The example pack, installed in the data folder and chosen in Settings ▸ Appearance: the masthead and the club
    /// card wear it at once.
    @MainActor
    func testGlassShellExamplePackLight() throws {
        let app = launch()
        waitForShell(app)
        app.typeKey(",", modifierFlags: .command)
        let appearance = app.toolbars.buttons["Appearance"].firstMatch
        XCTAssertTrue(appearance.waitForExistence(timeout: 5))
        appearance.click()
        let pack = app.radioButtons["Sunset Series"].firstMatch
        XCTAssertTrue(pack.waitForExistence(timeout: 10), "the example pack is not offered")
        pack.click()
        XCTAssertTrue(element(app, "settings.theme.preview").waitForExistence(timeout: 5))
        keep(app.windows.firstMatch.screenshot(), named: "glass-settings-theme")
        app.typeKey("w", modifierFlags: .command)
        try shellFlow(app, look: "sunset-series-light")
        quitCleanly(app)
    }

    /// The example pack in dark, chosen before launch (settings.json's `themePacks`).
    @MainActor
    func testGlassShellExamplePackDark() throws {
        var app = launch()
        try shellFlow(app, look: "sunset-series-dark")
        quitCleanly(app)
        app = launch(arguments: ["-PennantDebugAppearance", "increasedContrastDark"])
        try shellFlow(app, look: "sunset-series-dark-increased-contrast")
        quitCleanly(app)
    }

    // MARK: The Morning Report kept across launches (N6, Stage B1)

    /// The first launch fetches the Morning Report and keeps it in the app's own caches (the test's folder); the second
    /// launch draws it at once, said to be updating in the kicker, then swaps the fresh one in place. The time from
    /// launch to the first drawn report is recorded against the one-second budget (SWIFTUI_REBUILD.md "The speed
    /// budgets"): the app's own measure, from its log, and the test's wall clock, which includes the runner's launch.
    @MainActor
    func testLaunchWithKeptPayload() throws {
        let kept = scratch.appending(path: "caches/front-office", directoryHint: .isDirectory)
        var app = launch()
        waitForShell(app)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 60), "the Morning Report did not load")
        XCTAssertTrue(element(app, "masthead.kicker").waitForExistence(timeout: 10))
        // The fresh payload is kept once it lands
        let deadline = Date.now.addingTimeInterval(20)
        var keptFiles: [String] = []
        while keptFiles.isEmpty && Date.now < deadline {
            keptFiles = ((try? FileManager.default.contentsOfDirectory(atPath: kept.path(percentEncoded: false))) ?? []).filter { $0.hasSuffix(".json") }
            if keptFiles.isEmpty { RunLoop.current.run(until: Date.now.addingTimeInterval(0.25)) }
        }
        XCTAssertEqual(keptFiles.count, 1, "the Morning Report was not kept in \(kept.path)")
        keep(app.windows.firstMatch.screenshot(), named: "launch-fresh")
        quitCleanly(app)

        // The next launch: the kept report at once, updating
        let started = Date.now
        app = launch()
        let desk = element(app, "morningReport.desk")
        XCTAssertTrue(desk.waitForExistence(timeout: 60), "the kept Morning Report was not drawn")
        let wallMs = Int(Date.now.timeIntervalSince(started) * 1000)
        // The kept report says it is updating: seen in the kicker if the fresh one has not landed yet, and in any case
        // in the app's log, which the view writes when it draws the word (it may last less than a query takes)
        let sawUpdating = element(app, "masthead.kicker").label.contains("Updating")
        keep(app.windows.firstMatch.screenshot(), named: "launch-kept-payload")
        // The app's own measure, in its log, says the kept payload was drawn and how long after launch
        let log = scratch.appending(path: "logs/server.log")
        var line: String?
        let logDeadline = Date.now.addingTimeInterval(20)
        while line == nil && Date.now < logDeadline {
            line = (try? String(contentsOf: log, encoding: .utf8))?
                .split(separator: "\n").last { $0.contains("first Morning Report drawn") }.map(String.init)
            if line == nil { RunLoop.current.run(until: Date.now.addingTimeInterval(0.25)) }
        }
        XCTAssertTrue(line?.contains("from the kept payload") == true, "the second launch did not draw the kept payload: \(line ?? "no line")")
        let lines = (try? String(contentsOf: log, encoding: .utf8))?.split(separator: "\n") ?? []
        // This launch's lines: from its "server ready" on (the log holds both launches)
        let thisLaunch = lines.lastIndex { $0.contains("server ready") } ?? 0
        let saidUpdating = lines[thisLaunch...].contains { $0.contains("the Morning Report said Updating") }
        XCTAssertTrue(sawUpdating || saidUpdating, "the second launch never said the kept report was updating")
        let record = XCTAttachment(string: "launch to the first drawn Morning Report: \(wallMs) ms by the test's clock (with the runner's launch); the app: \(line ?? "not recorded"); \"Updating\" \(sawUpdating ? "seen in the kicker" : "in the app's log")")
        record.name = "launch-timing"
        record.lifetime = .keepAlways
        add(record)
        // The fresh one lands and the kicker stops saying it is updating
        let kicker = element(app, "masthead.kicker")
        let updated = Date.now.addingTimeInterval(60)
        while kicker.label.contains("Updating") && Date.now < updated { RunLoop.current.run(until: Date.now.addingTimeInterval(0.5)) }
        XCTAssertFalse(kicker.label.contains("Updating"), "the fresh Morning Report did not replace the kept one")
        keep(app.windows.firstMatch.screenshot(), named: "launch-kept-payload-updated")
        quitCleanly(app)
    }

    // MARK: The design language (N5, Stage B)

    /// The design on the Morning Report: the ⌘K palette opens a department's report by keyboard, a claim's basis opens
    /// on a click and pins to the inspector, Whole Desk is in the toolbar, and the audit passes with the sidebar
    /// unfolded and the inspector open.
    @MainActor
    func testDesignPaletteBasisAndInspector() throws {
        let app = launch()
        waitForShell(app)
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 20), "the Morning Report's desk did not load")
        XCTAssertTrue(element(app, "masthead").waitForExistence(timeout: 5))

        // ⌘K: the palette, its query, the arrow keys and Return
        app.typeKey("k", modifierFlags: .command)
        let query = element(app, "palette.query")
        XCTAssertTrue(query.waitForExistence(timeout: 5), "⌘K did not open the palette")
        query.typeText("major")
        XCTAssertTrue(element(app, "palette.result.view.majorLeague.report").waitForExistence(timeout: 5), "the palette did not list Major League Ops' report")
        sidebarAtTop(app)
        keep(app.windows.firstMatch.screenshot(), named: "design-palette")
        try audit(app, named: "accessibility-audit-design-palette")
        query.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 10), "Return did not open the palette's first result")
        XCTAssertTrue(element(app, "palette").waitForNonExistence(timeout: 5), "the palette stayed open")
        keep(app.windows.firstMatch.screenshot(), named: "design-report")
        try audit(app, named: "accessibility-audit-design-report")

        // Escape closes the palette without opening anything
        app.typeKey("k", modifierFlags: .command)
        XCTAssertTrue(element(app, "palette").waitForExistence(timeout: 5))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(element(app, "palette").waitForNonExistence(timeout: 5), "Escape did not close the palette")

        // A claim's basis: a click opens the popover; Pin to Inspector shows it in the inspector's evidence tab
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 20))
        let claim = app.descendants(matching: .any)["morningReport.desk"].firstMatch.descendants(matching: .any)["claim"].firstMatch
        XCTAssertTrue(claim.waitForExistence(timeout: 5), "no claim on the desk")
        claim.click()
        XCTAssertTrue(element(app, "basis.popover").waitForExistence(timeout: 5), "the click did not open the basis")
        // Space on the focused claim closes and opens it again, like Quick Look (section 3.3)
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(element(app, "basis.popover").waitForNonExistence(timeout: 5), "Escape did not close the basis")
        app.typeKey(" ", modifierFlags: [])
        XCTAssertTrue(element(app, "basis.popover").waitForExistence(timeout: 5), "Space on the focused claim did not open its basis")
        keep(app.windows.firstMatch.screenshot(), named: "design-basis-popover")
        let pin = element(app, "basis.pin")
        XCTAssertTrue(pin.waitForExistence(timeout: 5), "the popover offers no Pin to Inspector")
        pin.click()
        XCTAssertTrue(element(app, "inspector.evidence").waitForExistence(timeout: 10), "the pinned claim did not reach the inspector")
        sidebarAtTop(app)
        keep(app.windows.firstMatch.screenshot(), named: "design-inspector-evidence")
        try audit(app, named: "accessibility-audit-design-inspector")
        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertTrue(element(app, "inspector").waitForNonExistence(timeout: 5))

        // Whole Desk is a toolbar item, and nothing floats over the content
        let wholeDesk = element(app, "morningReport.wholeDesk")
        XCTAssertTrue(wholeDesk.waitForExistence(timeout: 5))
        XCTAssertTrue(app.toolbars.firstMatch.descendants(matching: .any)["morningReport.wholeDesk"].firstMatch.exists, "Whole Desk is not in the toolbar")
        wholeDesk.click()
        XCTAssertTrue(element(app, "detail.frontOffice.report").waitForExistence(timeout: 10), "Whole Desk did not open the Front Office's report")
        quitCleanly(app)
    }

    /// The example art pack (`docs/theme-packs/aurora-nights`) chosen before launch: the masthead wears its colours and
    /// its art, in light and in dark, each audited.
    @MainActor
    func testDesignArtPackLight() throws {
        let app = launch()
        try shellFlow(app, look: "aurora-nights-light")
        quitCleanly(app)
    }

    @MainActor
    func testDesignArtPackDark() throws {
        var app = launch()
        try shellFlow(app, look: "aurora-nights-dark")
        quitCleanly(app)
        app = launch(arguments: ["-PennantDebugAppearance", "increasedContrastDark"])
        try shellFlow(app, look: "aurora-nights-dark-increased-contrast")
        quitCleanly(app)
    }
}
