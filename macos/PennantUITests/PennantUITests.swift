import AppKit
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
        // A fresh window each time: no restored route from an earlier run; no notification permission asked of the Mac
        // running the tests (Pennant asks at the first export read while it is in front, L4)
        app.launchArguments += ["-ApplePersistenceIgnoreState", "YES", "-PennantNotifiesNewExport", "NO"] + arguments
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
        // The shell is drawn while the server starts (N6, Stage B2): the view says "Starting…" until it is ready
        XCTAssertTrue(element(app, "server.waiting").waitForNonExistence(timeout: 60), "the server did not become ready; see \(scratch.path)/logs/server.log")
    }

    @MainActor
    private func keep(_ screenshot: XCUIScreenshot, named name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The accessibility audit, with every issue it finds named: its kind, what it says and the element, kept as a
    /// text attachment and in the failure, so a finding says where it is. What is set aside is counted and each line
    /// printed to the test's output (`[audit] …`), which `test.sh` repeats, so it shows in the CI log.
    ///
    /// Set aside, each listed with its reason (anything else fails the test):
    /// - "no description" on the sidebar column's own container, a nameless, id-less group spanning its window's full
    ///   height over the sidebar's columns only (the split view's hosting view, which no SwiftUI modifier reaches; the app
    ///   names it, `SidebarColumnName`, and this covers a runner where the name does not reach the audit). Any other
    ///   nameless group fails;
    /// - anything on the Touch Bar the system draws (its own container, and its keys, such as "emoji & symbols");
    /// - "parent/child mismatch" inside the window's own close, minimise or zoom button (AppKit's zoom-menu view in the
    ///   title bar; the app draws nothing there), and one the audit attributes to no element (seen only with the ⌘K
    ///   palette up);
    /// - a contrast finding on an element wholly outside every window's frame, or cut by its window's edge (text of a
    ///   report longer than its window, scrolled wholly or partly out of view: the audit measures pixels that are not the
    ///   text's, or a sliver of it; N7);
    /// - a contrast finding on a sidebar row label (`sidebar.…`) only: outside the sidebar's visible frame (GitHub's runner
    ///   has a 1024 × 768 screen, so rows below the window are measured against pixels that are not theirs), or inside it
    ///   when its own pixels, in a screenshot of the window that holds it taken at the audit, read at 4.5:1 or better
    ///   (`WindowPixels.contrast`: the darkest (or lightest) tenth of the text's own ink against the element's middle). On the runner
    ///   those labels, the system's vibrant text on its glass, were reported in a different handful on each run while
    ///   their pixels read at 9:1 to 19:1; the line carries the measured ratio, so it is checked, not muted. Every other
    ///   contrast finding fails, and so does a sidebar label whose pixels read below 4.5:1;
    /// - a contrast finding on the report's text under the inspector, which the system lays over the report's trailing
    ///   side on a window too narrow for the sidebar, the report and the inspector (GitHub's runner: "Through May 5, 2040
    ///   · 30 games" was measured with all but "Throu" under the inspector); the inspector's own texts are never set
    ///   aside this way;
    /// - a contrast finding on a text element on a 1× screen only (a window whose screenshot has one pixel per point:
    ///   GitHub's runner, never a Retina Mac), when its own pixels read at 4.5:1 or better (`WindowPixels.contrast`, which
    ///   reads a 1× text below its colours' ratio, since its thin strokes are blended with the page). At 1× the audit's
    ///   contrast does not follow the text's colours: on the runner (run 36910001280) a page of text samples on white had
    ///   "Scoring runs" in the callout size at medium weight reported in pure black ("nearly passed", 16.7:1 by its pixels),
    ///   in the label colour and in 20% and 30% greys ("failed"), while the same words at regular weight or in the body
    ///   size, and other words in every size, weight and colour sampled, passed; the app's findings there were black and
    ///   dark-grey text reading 4.6:1 to 9.5:1 by their pixels, which pass the same audit on a Retina screen. The line
    ///   carries the measured ratio, so it is checked, not muted; below 4.5:1 it fails, and on a Retina screen every
    ///   contrast finding fails.
    @MainActor
    private func audit(_ app: XCUIApplication, named name: String = "accessibility-audit") throws {
        // The pointer off the content first, and any help tag it left up gone (waited for, never a fixed sleep): a tag
        // is the system's, and one left over a line by the last click is measured as that line's background
        let front = app.windows.firstMatch
        if front.exists { front.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01)).hover() }
        XCTAssertTrue(app.helpTags.firstMatch.waitForNonExistence(timeout: 5), "a help tag stayed up over the window")
        var issues: [String] = []
        var setAside: [String] = []
        // Each contrast finding's element, whose own picture is kept beside the findings (the element alone, as the
        // audit asks for it)
        var pictured: [XCUIElement] = []
        // Each window with its own pixels, so an element is measured in the window that holds it
        let shots = app.windows.allElementsBoundByIndex.map { window in (frame: window.frame, shot: window.screenshot()) }
        let windows = shots.map { (frame: $0.frame, pixels: WindowPixels($0.shot.image, frame: $0.frame)) }
        // The window as the audit saw it, kept beside its findings
        if let first = shots.first { keep(first.shot, named: "\(name)-window") }
        let touchBar = app.touchBars.firstMatch
        let touchBarFrame = touchBar.exists ? touchBar.frame.insetBy(dx: -2, dy: -2) : nil
        let sidebar = app.outlines["sidebar"].firstMatch
        let sidebarFrame = sidebar.exists ? sidebar.frame : nil
        // Every window's own close, minimise and zoom buttons: found by their identifiers, and the strip of the title bar
        // they sit in (on GitHub's runner the zoom button's menu view was reported where no button was found)
        let controls = [XCUIIdentifierCloseWindow, XCUIIdentifierMinimizeWindow, XCUIIdentifierZoomWindow].flatMap { id in
            app.buttons.matching(identifier: id).allElementsBoundByIndex.map { $0.frame.insetBy(dx: -2, dy: -2) }
        } + windows.map { CGRect(x: $0.frame.minX, y: $0.frame.minY, width: 90, height: 52) }
        // The inspector column, where one is open: on a window too narrow for the sidebar, the report and the inspector
        // (GitHub's runner, a 1024-point-wide screen) the system lays the inspector over the report's trailing side
        let inspector = app.descendants(matching: .any)["inspector"].firstMatch
        let inspectorFrame = inspector.exists ? inspector.frame : nil
        /// Whether an element is text of the report under the inspector: its frame meets the inspector's, and it is not
        /// one of the inspector's own texts.
        func isUnderInspector(_ frame: CGRect) -> Bool {
            guard let inspectorFrame, inspectorFrame.intersects(frame) else { return false }
            return !inspector.staticTexts.allElementsBoundByIndex.contains { $0.frame == frame }
        }
        /// The sidebar column's container: a window's full height, from its left edge to the sidebar's right edge.
        func isSidebarColumn(_ frame: CGRect) -> Bool {
            guard let sidebarFrame else { return false }
            return windows.contains { $0.frame.minY == frame.minY && $0.frame.height == frame.height }
                && abs(frame.minX - sidebarFrame.minX) <= 12 && abs(frame.maxX - sidebarFrame.maxX) <= 12
        }
        // The served tables (N8): native `Table`s, whose rows AppKit draws in cell containers of its own
        let servedTables = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'table.'"))
            .allElementsBoundByIndex.map(\.frame)
        func isInServedTable(_ frame: CGRect) -> Bool { servedTables.contains { $0.contains(frame) } }
        try app.performAccessibilityAudit { issue in
            let element = issue.element
            let line = "\(issue.auditType): \(issue.compactDescription): "
                + (element.map { "type \($0.elementType.rawValue) id='\($0.identifier)' label='\($0.label)' frame=\($0.frame)" } ?? "no element")
            guard let element else {
                // A parent/child mismatch the audit attributes to no element (seen only with the ⌘K palette up, on the
                // runner and here): nothing it names can be found or measured, so it is listed, never hidden
                if issue.auditType == .parentChild {
                    setAside.append(line + " (the audit names no element)")
                } else {
                    issues.append(line)
                }
                return true
            }
            let frame = element.frame
            if issue.auditType == .contrast, !windows.contains(where: { $0.frame.intersects(frame) }) {
                // Scrolled wholly out of its window (a report longer than the window): none of its pixels are on the
                // screen, so what the audit measured there is not its text
                setAside.append(line + " (wholly outside its window's frame: scrolled out of view)")
            } else if issue.auditType == .contrast, !windows.contains(where: { $0.frame.contains(frame) }) {
                // Cut by its window's edge (a line of a report longer than the window, partly scrolled out of view): the
                // audit measures the whole line, of which only a sliver is on the screen
                setAside.append(line + " (cut by its window's edge: partly scrolled out of view)")
            } else if element.elementType == .touchBar || (touchBarFrame.map { $0.contains(frame) } ?? false) {
                setAside.append(line + " (the Touch Bar the system draws, or a key on it)")
            } else if issue.auditType == .sufficientElementDescription, element.elementType == .group,
                      element.identifier.isEmpty, element.label.isEmpty, isSidebarColumn(frame) {
                setAside.append(line + " (the sidebar column's own container)")
            } else if issue.auditType == .sufficientElementDescription, element.elementType == .group,
                      element.identifier.isEmpty, element.label.isEmpty, isInServedTable(frame),
                      element.staticTexts.allElementsBoundByIndex.contains(where: { !$0.label.isEmpty || !(($0.value as? String) ?? "").isEmpty }) {
                // A served table's cell: AppKit's own container around the cell's text, which no SwiftUI modifier reaches
                // (a label on the cell's content makes a second element inside it, and the container stays unnamed); the
                // text inside it is named, and that is what VoiceOver reads
                setAside.append(line + " (a served table's cell container; its text is named)")
            } else if issue.auditType == .contrast, element.elementType == .staticText, isInServedTable(frame),
                      let ratio = windows.first(where: { $0.frame.contains(frame) })?.pixels?.contrast(in: frame), ratio >= 4.5 {
                // A served table cell's short text (a hand, a share, a number): the audit reported glyphs of one to three
                // characters in the label colour on the page as failing while their own pixels read at 8:1 to 15:1; the
                // line carries the measured ratio, so it is checked, not muted, and below 4.5:1 it fails
                setAside.append(line + String(format: " (a served table cell's text whose own pixels read at %.1f:1)", ratio))
            } else if issue.auditType == .contrast, element.elementType == .staticText, frame.width <= 60, frame.height <= 24,
                      let ratio = windows.first(where: { $0.frame.contains(frame) })?.pixels?.contrast(in: frame), ratio >= 7 {
                // A text of a few characters (a number such as "22", a chip's word such as "Now"): the audit reported such
                // short texts in the label colour as failing or nearly passing while their own pixels read at 13:1 to 15:1
                // (N8). Only at 7:1 or better by its pixels, the Increase Contrast bar; the line carries the ratio
                setAside.append(line + String(format: " (a short text whose own pixels read at %.1f:1)", ratio))
            } else if issue.auditType == .parentChild, element.elementType == .group, frame.width <= 16, frame.height <= 16,
                      controls.contains(where: { $0.contains(frame) }) {
                setAside.append(line + " (inside the window's own title-bar button)")
            } else if issue.auditType == .contrast, element.identifier.hasPrefix("sidebar.") {
                let holder = windows.first { $0.frame.contains(frame) }
                let visible = holder != nil && (sidebarFrame.map { $0.contains(frame) } ?? false)
                let ratio = visible ? holder?.pixels?.contrast(in: frame) : nil
                if !visible {
                    setAside.append(line + " (a sidebar row outside the sidebar's visible frame)")
                } else if let ratio, ratio >= 4.5 {
                    setAside.append(line + String(format: " (a sidebar row whose own pixels read at %.1f:1)", ratio))
                } else {
                    issues.append(line + (ratio.map { String(format: " (its own pixels read at %.1f:1)", $0) } ?? ""))
                }
            } else if issue.auditType == .contrast, isUnderInspector(frame) {
                // Covered, wholly or partly, by the inspector laid over the report: what the audit measured there is the
                // inspector's pixels, not the text's
                setAside.append(line + " (report text under the inspector laid over it on a narrow window)")
            } else if issue.auditType == .contrast, element.elementType == .staticText,
                      let pixels = windows.first(where: { $0.frame.contains(frame) })?.pixels, pixels.scale < 1.5,
                      let ratio = pixels.contrast(in: frame), ratio >= 4.5 {
                // Text on a 1× screen (GitHub's runner) whose own pixels read at 4.5:1 or better: there the audit's
                // contrast is not the text's colour (see the doc comment); its pixels are the check
                setAside.append(line + String(format: " (text on a 1× screen whose own pixels read at %.1f:1)", ratio))
            } else if issue.auditType == .contrast {
                // Never set aside: its own pixels are measured only to help find it
                let ratio = windows.first { $0.frame.contains(frame) }?.pixels?.contrast(in: frame)
                issues.append(line + (ratio.map { String(format: " (its own pixels read at %.1f:1)", $0) } ?? ""))
                pictured.append(element)
            } else {
                issues.append(line)
            }
            return true
        }
        print("[audit] \(name): \(issues.count) finding(s), \(setAside.count) set aside")
        for line in setAside { print("[audit] \(name): set aside: \(line)") }
        for line in issues { print("[audit] \(name): FINDING: \(line)") }
        for (index, element) in pictured.enumerated() where element.exists {
            keep(element.screenshot(), named: "\(name)-finding-\(index + 1)")
        }
        let attachment = XCTAttachment(string: (["Findings:"] + issues + ["", "Set aside (\(setAside.count)), each with its reason:"] + setAside).joined(separator: "\n"))
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(issues, [], "the accessibility audit found issues")
    }

    /// Scrolls a container (an element, never the screen) until the target is there and can be clicked: a report draws
    /// its lower sections lazily, so the target may exist only once scrolled to. Down first (as `testMajorLeagueViews`
    /// reaches the glances), then up.
    /// The scroll is aimed at the container's leading side: on a window too narrow for the sidebar, the content and the
    /// inspector, the system lays the inspector over the content's trailing side, and a scroll at the container's middle
    /// would land on the inspector.
    @MainActor
    private func reveal(_ target: XCUIElement, in container: XCUIElement) {
        let leading = container.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.6))
        for delta in [-2000.0, -2000, -2000, -2000, 5000, 3000, 3000] {
            if target.exists && target.isHittable { return }
            leading.scroll(byDeltaX: 0, deltaY: delta)
            _ = target.waitForExistence(timeout: 1)
        }
    }

    /// Scrolls a container until the target lies wholly inside the window (not cut by its bottom edge), so the audit reads
    /// the element itself; whichever way moves it up is kept.
    @MainActor
    private func wholly(_ target: XCUIElement, in container: XCUIElement, of window: XCUIElement) {
        let leading = container.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.6))
        var delta = -150.0
        for _ in 0..<8 where target.exists && target.frame.maxY > window.frame.maxY - 12 {
            let before = target.frame.maxY
            leading.scroll(byDeltaX: 0, deltaY: delta)
            _ = target.waitForExistence(timeout: 0.5)
            if target.frame.maxY >= before { delta = -delta }
        }
    }

    /// A served table's first row, whether the table's identifier is on the table itself or on a container around it.
    @MainActor
    private func firstRow(of table: XCUIElement) -> XCUIElement {
        switch table.elementType {
        case .outline: table.outlineRows.firstMatch
        case .table: table.tableRows.firstMatch
        default: table.descendants(matching: .outlineRow).firstMatch
        }
    }

    /// The sidebar at its top, as a window opens: its departments stay unfolded (the audit reads every row there is).
    @MainActor
    private func sidebarAtTop(_ app: XCUIApplication) {
        // Out of VoiceOver's reach (so not there to scroll) while the ⌘K palette is up
        let sidebar = app.outlines["sidebar"].firstMatch
        if sidebar.exists { sidebar.scroll(byDeltaX: 0, deltaY: 2000) }
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

    /// First run with no pretend home (so nothing is chosen by itself): the server has no save, so Setup opens. A
    /// folder is picked by path and the import runs; the save's export names the one club its human manages, so the
    /// club is taken from it (N6, Stage B2): Setup closes on its own and the main window shows the club.
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

        XCTAssertTrue(setup.waitForNonExistence(timeout: 60), "Setup did not close once the import landed with the club taken from the save")
        XCTAssertFalse(element(app, "setup.clubs").exists, "the club was asked though the save names it")
        waitForShell(app)
        XCTAssertTrue(element(app, "club.card").waitForExistence(timeout: 10))
        keep(app.windows.firstMatch.screenshot(), named: "main-window-after-setup")
        quitCleanly(app)
    }

    /// The zero-question first run (N6, Stage B2, D-063): a pretend home holds one OOTP save, played two hours ago with
    /// an export, and nothing is chosen yet. The app asks nothing: the server chooses and imports that save, takes the
    /// club from it, and the Morning Report appears. No list of saves and no club question are ever shown.
    @MainActor
    func testZeroQuestionFirstRun() throws {
        let home = scratch.appending(path: "home", directoryHint: .isDirectory)
        let app = launch(environment: ["PENNANT_DEV_HOME": home.path(percentEncoded: false)])
        let desk = element(app, "morningReport.desk")
        var sawChooser = false
        var sawClubs = false
        let deadline = Date.now.addingTimeInterval(90)
        while !desk.exists && Date.now < deadline {
            if element(app, "setup.save.Synthetic League").exists { sawChooser = true }
            if element(app, "setup.clubs").exists { sawClubs = true }
            _ = desk.waitForExistence(timeout: 0.5)
        }
        XCTAssertTrue(desk.exists, "the Morning Report did not appear; see \(scratch.path)/logs/server.log")
        XCTAssertFalse(sawChooser, "the saves were listed though one clearly stands out")
        XCTAssertFalse(sawClubs, "the club was asked though the save names it")
        XCTAssertTrue(element(app, "setup").waitForNonExistence(timeout: 20), "Setup stayed open")
        XCTAssertTrue(element(app, "club.card").waitForExistence(timeout: 10))
        let config = (try? String(contentsOf: dataFolder.appending(path: "config.json"), encoding: .utf8)) ?? ""
        XCTAssertTrue(config.contains("Synthetic League.lg"), "the server did not choose the save that stands out: \(config)")
        keep(app.windows.firstMatch.screenshot(), named: "setup-zero-question-morning-report")
        quitCleanly(app)
    }

    /// The club owed (N6, Stage B2 review, M4): the save that stands out is chosen by itself, but its human manages two
    /// clubs, so the club is asked. The GM closes Setup before answering: the main window draws no report, says why in
    /// the server's words, and "Choose Your Club…" brings Setup back to the club question. Saving a club lets the report
    /// through.
    @MainActor
    func testClubOwedAfterSetupCloses() throws {
        let home = scratch.appending(path: "home", directoryHint: .isDirectory)
        let app = launch(environment: ["PENNANT_DEV_HOME": home.path(percentEncoded: false)])
        let setup = element(app, "setup")
        XCTAssertTrue(setup.waitForExistence(timeout: 60), "Setup did not open for a server with no save")
        // Closed as soon as the save is chosen by itself, before the club is answered (mid-import on a slow runner)
        let chosen = Date.now.addingTimeInterval(60)
        while !element(app, "setup.importing").exists && !element(app, "setup.clubs").exists && Date.now < chosen {
            RunLoop.current.run(until: Date.now.addingTimeInterval(0.25))
        }
        XCTAssertTrue(element(app, "setup.importing").exists || element(app, "setup.clubs").exists, "the save was not chosen by itself")
        setup.click()
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(setup.waitForNonExistence(timeout: 10), "Setup did not close")
        waitForShell(app)
        let pending = element(app, "detail.clubPending")
        XCTAssertTrue(pending.waitForExistence(timeout: 60), "the report was not held while the club is owed")
        // The import lands meanwhile (the server records it in the data folder); the report stays held
        let landed = dataFolder.appending(path: "last-import.json")
        let deadline = Date.now.addingTimeInterval(90)
        while (try? String(contentsOf: landed, encoding: .utf8))?.contains("Two Clubs") != true, Date.now < deadline {
            RunLoop.current.run(until: Date.now.addingTimeInterval(0.5))
        }
        XCTAssertTrue((try? String(contentsOf: landed, encoding: .utf8))?.contains("Two Clubs") == true, "the import did not land; see \(scratch.path)/logs/server.log")
        RunLoop.current.run(until: Date.now.addingTimeInterval(3))
        XCTAssertTrue(pending.exists, "the held view went away with the club still owed")
        XCTAssertFalse(element(app, "morningReport.desk").exists, "a report was drawn before its club was confirmed")
        XCTAssertTrue(element(app, "detail.clubPending.why").exists, "the held view does not say why")
        keep(app.windows.firstMatch.screenshot(), named: "setup-club-owed-held")
        // Back to the club question
        element(app, "detail.pickClub").click()
        XCTAssertTrue(element(app, "setup.clubs").waitForExistence(timeout: 60), "Choose Your Club… did not bring back the club question")
        keep(app.windows.firstMatch.screenshot(), named: "setup-club-owed-question")
        element(app, "setup.saveClub").click()
        XCTAssertTrue(setup.waitForNonExistence(timeout: 30), "Setup stayed open after the club was saved")
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 60), "the report did not follow the saved club")
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
            // The kept reports, not the index that names the last one (`index.json`) or a write under way
            keptFiles = ((try? FileManager.default.contentsOfDirectory(atPath: kept.path(percentEncoded: false))) ?? [])
                .filter { $0.hasSuffix(".json") && $0 != "index.json" && !$0.hasPrefix(".") }
            if keptFiles.isEmpty { RunLoop.current.run(until: Date.now.addingTimeInterval(0.25)) }
        }
        XCTAssertEqual(keptFiles.count, 1, "the Morning Report was not kept in \(kept.path)")
        keep(app.windows.firstMatch.screenshot(), named: "launch-fresh")
        quitCleanly(app)

        // The next launch: the kept report at once, updating
        let started = Date.now
        app = launch()
        // The frame is stable from the first draw (N6 polish): when the sidebar is first there, the club card (from the
        // report kept last) and the report's toolbar (Whole Desk) are there with it, whether or not the report is yet
        XCTAssertTrue(element(app, "sidebar").waitForExistence(timeout: 60))
        XCTAssertTrue(element(app, "club.card").exists, "the club card was not in the window's first frames")
        XCTAssertTrue(element(app, "morningReport.wholeDesk").exists, "the toolbar changed after the window's first frames")
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
        // The query takes the keyboard as the palette opens; a click makes sure of it on a runner whose window is slow
        // to become key
        query.click()
        // Words that name one view, so the first result is the same whichever list is up (the registry's, or the
        // server's, which orders a department's views by name)
        query.typeText("major report")
        // The registry's entry until the server's answer is in, the served one after (the last answer stays while the
        // next is asked, L3, so which one shows depends on how fast the keys arrive)
        let report = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier IN %@", ["palette.result.view.majorLeague.report", "palette.result.search.view.majorLeague/report"]
        )).firstMatch
        XCTAssertTrue(report.waitForExistence(timeout: 10), "the palette did not list Major League Ops' report")
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
        // The report back at its top: the click scrolled it, and text passing under the toolbar's fading edge is not
        // text the GM reads there
        element(app, "detail.frontOffice.morningReport").scroll(byDeltaX: 0, deltaY: 5000)
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

    // MARK: Pennant remembers, and the league is alive (N7, Stage B)

    /// A context menu's item by its title: the open menu's, never the menu bar's closed menu of the same title (whose
    /// items are in the tree with no size).
    @MainActor
    private func contextMenuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        // Waited for as an expectation (L8), never a fixed sleep
        var found: XCUIElement?
        let open = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            found = app.menuItems.matching(NSPredicate(format: "title == %@", title)).allElementsBoundByIndex.first { $0.frame.width > 0 }
            return found != nil
        }, object: nil)
        _ = XCTWaiter.wait(for: [open], timeout: 5)
        return found ?? app.menuItems["no open menu item titled \(title)"]
    }

    /// The first open item on the desk, as the Morning Report shows it.
    @MainActor
    private func firstDeskItem(_ app: XCUIApplication) -> XCUIElement {
        element(app, "morningReport.desk").descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'item.' AND NOT (identifier BEGINSWITH 'item.urgency') AND NOT (identifier BEGINSWITH 'item.options') AND NOT (identifier BEGINSWITH 'item.status') AND NOT (identifier BEGINSWITH 'item.note') AND NOT (identifier BEGINSWITH 'item.still')")).firstMatch
    }

    /// The desk (D-058): an item marked Reviewed from its context menu leaves the lead list for the served "1 reviewed"
    /// line, and ⌘Z puts it back through the server's own undo request; ⇧⌘Z marks it again. Audited with the item set
    /// aside and the set-aside list open.
    @MainActor
    func testDeskMarkAndUndo() throws {
        let app = launch()
        waitForShell(app)
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 30), "the Morning Report's desk did not load")
        let item = firstDeskItem(app)
        XCTAssertTrue(item.waitForExistence(timeout: 10), "no item on the desk")
        let key = item.identifier
        item.rightClick()
        let mark = contextMenuItem(app, "Mark Reviewed")
        XCTAssertTrue(mark.waitForExistence(timeout: 5), "the item's context menu has no Mark Reviewed")
        mark.click()
        XCTAssertTrue(element(app, "desk.setAside").waitForExistence(timeout: 10), "the served set-aside line did not appear")
        XCTAssertTrue(element(app, "morningReport.desk").descendants(matching: .any)[key].firstMatch.waitForNonExistence(timeout: 10), "the item stayed on the desk")
        // The report back at its top: the right-click scrolled the item into view, and text under the toolbar's fading
        // edge is not text the GM reads there
        element(app, "detail.frontOffice.morningReport").scroll(byDeltaX: 0, deltaY: 5000)
        keep(app.windows.firstMatch.screenshot(), named: "n7-desk-marked")
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n7-desk-marked")
        element(app, "desk.setAside").click()
        XCTAssertTrue(element(app, "desk.setAside.list").waitForExistence(timeout: 5), "the set-aside line did not open its items")
        keep(app.windows.firstMatch.screenshot(), named: "n7-desk-set-aside")
        app.typeKey(.escape, modifierFlags: [])
        // Undo, through the window's undo manager and the server's own request
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").descendants(matching: .any)[key].firstMatch.waitForExistence(timeout: 10), "⌘Z did not put the item back on the desk")
        XCTAssertTrue(element(app, "desk.setAside").waitForNonExistence(timeout: 10), "the set-aside line stayed after ⌘Z")
        // Redo marks it again
        app.typeKey("z", modifierFlags: [.command, .shift])
        XCTAssertTrue(element(app, "desk.setAside").waitForExistence(timeout: 10), "⇧⌘Z did not mark it again")
        keep(app.windows.firstMatch.screenshot(), named: "n7-desk-redone")
        // Put back from the set-aside list (a popover, a window of its own): the list closes once nothing is set aside
        // (L2), and ⌘Z in the main window undoes it, since the list registers on the main window's undo manager (M6)
        element(app, "desk.setAside").click()
        let list = element(app, "desk.setAside.list")
        XCTAssertTrue(list.waitForExistence(timeout: 5), "the set-aside line did not open its items")
        let row = list.descendants(matching: .any)[key].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the set-aside list did not list the item")
        row.rightClick()
        let putBack = contextMenuItem(app, "Put Back on Desk")
        XCTAssertTrue(putBack.waitForExistence(timeout: 5), "the set-aside item's context menu has no Put Back on Desk")
        putBack.click()
        XCTAssertTrue(element(app, "morningReport.desk").descendants(matching: .any)[key].firstMatch.waitForExistence(timeout: 10), "Put Back on Desk did not put the item back")
        XCTAssertTrue(list.waitForNonExistence(timeout: 10), "the set-aside list stayed open with nothing set aside")
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(element(app, "desk.setAside").waitForExistence(timeout: 10), "⌘Z in the main window did not undo the put-back made in the set-aside list")
        XCTAssertTrue(element(app, "morningReport.desk").descendants(matching: .any)[key].firstMatch.waitForNonExistence(timeout: 10), "the item stayed on the desk after ⌘Z")
        quitCleanly(app)
    }

    /// Major League Ops (N8): the report with the staff at a glance; a glance opens Position players (a native table);
    /// Bench & Backups' table selects a row and draws its served detail, and its context menu offers the player's
    /// actions; the report's need opens its decision, whose served choice asks again; Back returns. Audited on each view.
    @MainActor
    func testMajorLeagueViews() throws {
        // A 1280-point window: the captures at the size the GM most often uses (the narrow one has its own test)
        let app = launch(arguments: ["-PennantDebugWindowSize", "1280x820"])
        waitForShell(app)
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 30), "⌘2 did not open Major League Ops")
        let glance = element(app, "glance.positionPlayers")
        // The report draws its lower sections as they are scrolled to: the glances are at its foot
        reveal(glance, in: element(app, "detail.majorLeague.report"))
        if !glance.waitForExistence(timeout: 30) { keep(app.windows.firstMatch.screenshot(), named: "n8-1280-missing-glance") }
        XCTAssertTrue(glance.exists, "the staff at a glance did not load")
        // The companion's foot (the what-if) wholly in the window, not cut by its edge, for the capture and the audit
        reveal(element(app, "whatIf"), in: element(app, "detail.majorLeague.report"))
        wholly(element(app, "whatIf"), in: element(app, "detail.majorLeague.report"), of: app.windows.firstMatch)
        keep(app.windows.firstMatch.screenshot(), named: "n8-1280-report-glances")
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n8-report")
        reveal(glance, in: element(app, "detail.majorLeague.report"))
        glance.click()
        let lineup = element(app, "table.lineup")
        XCTAssertTrue(lineup.waitForExistence(timeout: 20), "Position players' table did not load")
        keep(app.windows.firstMatch.screenshot(), named: "n8-1280-position-players")
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n8-position-players")
        // Back to the report, then on to the bench
        app.typeKey("[", modifierFlags: .command)
        let benchGlance = element(app, "glance.benchBackups")
        reveal(benchGlance, in: element(app, "detail.majorLeague.report"))
        XCTAssertTrue(benchGlance.waitForExistence(timeout: 20), "Back did not return to the report")
        benchGlance.click()
        let bench = element(app, "table.bench")
        XCTAssertTrue(bench.waitForExistence(timeout: 20), "the bench's table did not load")
        let row = firstRow(of: bench)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the bench's table has no row")
        // A row's leading side (its name): the outline reports the row itself as not hittable
        let rowName = row.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5))
        rowName.click()
        XCTAssertTrue(element(app, "row.detail").waitForExistence(timeout: 10), "selecting a row did not draw its served detail")
        rowName.rightClick()
        XCTAssertTrue(contextMenuItem(app, "Copy Name").waitForExistence(timeout: 5), "the row's context menu has no Copy Name")
        app.typeKey(.escape, modifierFlags: [])
        keep(app.windows.firstMatch.screenshot(), named: "n8-1280-bench-row-selected")
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n8-bench")
        // The report's need opens its decision
        app.typeKey("2", modifierFlags: .command)
        let open = element(app, "item.decision")
        XCTAssertTrue(open.waitForExistence(timeout: 20), "the report's need offers no decision")
        open.click()
        XCTAssertTrue(element(app, "decision.header").waitForExistence(timeout: 30), "the decision did not load")
        keep(app.windows.firstMatch.screenshot(), named: "n8-1280-decision")
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n8-decision")
        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 10), "Back did not return from the decision")
        // A what-if always serves its durations: choosing one loads that decision, which then says it is the one chosen
        // (the served `selected`), never skipped
        let whatIf = element(app, "whatIf")
        XCTAssertTrue(whatIf.waitForExistence(timeout: 20), "the report offers no what-if")
        whatIf.click()
        let player = app.descendants(matching: .button).matching(NSPredicate(format: "identifier BEGINSWITH 'whatIf.player.'")).firstMatch
        XCTAssertTrue(player.waitForExistence(timeout: 10), "the what-if lists no player")
        player.click()
        let duration = element(app, "choices.duration")
        XCTAssertTrue(duration.waitForExistence(timeout: 30), "the what-if's decision serves no durations")
        duration.click()
        let fortnight = contextMenuItem(app, "Two weeks")
        XCTAssertTrue(fortnight.exists, "the served durations have no \"Two weeks\"")
        fortnight.click()
        let chosen = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (duration.value as? String) == "Two weeks" }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [chosen], timeout: 30), .completed, "the decision for the chosen duration did not load")
        XCTAssertTrue(element(app, "decision.header").exists)
        keep(app.windows.firstMatch.screenshot(), named: "n8-1280-decision-what-if-two-weeks")
        quitCleanly(app)
    }

    /// The narrow window (the N8 review, H2): 900 × 700 with the inspector open, where a table nested in a page's scroll
    /// view made AppKit abort ("more Update Constraints in Window passes than there are views in the window"). Every
    /// Major League Ops view in turn and back to the report, three rounds, a row selected in each table and a decision's
    /// candidates opened: the app stays up throughout and quits cleanly.
    @MainActor
    func testMajorLeagueNarrowWindow() throws {
        let app = launch(arguments: ["-PennantDebugWindowSize", "900x700", "-PennantDebugInspector", "YES"])
        waitForShell(app)
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 30), "⌘2 did not open Major League Ops")
        let window = app.windows.firstMatch
        let narrow = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in window.frame.width <= 905 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [narrow], timeout: 15), .completed, "the window did not take the narrow size")
        XCTAssertTrue(element(app, "inspector").waitForExistence(timeout: 10), "the inspector is not open")
        let up = { (step: String) in XCTAssertEqual(app.state, .runningForeground, "the app stopped at \(step)") }
        // Clicks aimed at an element's leading side: on a window this narrow the system lays the inspector over the
        // content's trailing side, and a click at a wide element's middle would land on the inspector
        let leading = { (target: XCUIElement) in target.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).click() }
        let views: [(view: String, table: String)] = [
            ("positionPlayers", "table.lineup"), ("pitchingStaff", "table.pitching.0"), ("benchBackups", "table.bench"),
        ]
        keep(window.screenshot(), named: "n8-narrow-900-report")
        for round in 1...3 {
            for view in views {
                let item = element(app, "sidebar.majorLeague.\(view.view)")
                XCTAssertTrue(item.waitForExistence(timeout: 10), "round \(round): the sidebar has no \(view.view)")
                item.click()
                let table = element(app, view.table)
                if !table.waitForExistence(timeout: 20) { keep(window.screenshot(), named: "n8-narrow-900-missing-\(view.table)") }
                XCTAssertTrue(table.exists, "round \(round): \(view.view)'s table did not load")
                let row = firstRow(of: table)
                XCTAssertTrue(row.waitForExistence(timeout: 10), "round \(round): \(view.view)'s table has no row")
                leading(row)
                XCTAssertTrue(element(app, "row.detail").waitForExistence(timeout: 10), "round \(round): \(view.view)'s row detail did not draw")
                if view.view == "pitchingStaff" {
                    let pen = element(app, "pitching.sections").radioButtons.element(boundBy: 1)
                    if pen.exists {
                        pen.click()
                        XCTAssertTrue(element(app, "table.pitching.1").waitForExistence(timeout: 10), "round \(round): the pen's table did not draw")
                    }
                }
                if round == 1 { keep(window.screenshot(), named: "n8-narrow-900-\(view.view)") }
                up("\(view.view), round \(round)")
                app.typeKey("[", modifierFlags: .command)
                XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 10), "round \(round): Back did not return to the report")
                up("the report, round \(round)")
            }
            // Decision: the open needs, one opened and back; a what-if (a scenario with candidates), its candidates in
            // their table, and back
            let inbox = element(app, "sidebar.majorLeague.decision")
            XCTAssertTrue(inbox.waitForExistence(timeout: 10), "round \(round): the sidebar has no Decision")
            inbox.click()
            let needs = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'need.'"))
            let need = needs.firstMatch
            if !need.waitForExistence(timeout: 20) { keep(window.screenshot(), named: "n8-narrow-900-missing-need") }
            XCTAssertTrue(need.exists, "round \(round): the decision list has no open need")
            leading(need)
            XCTAssertTrue(element(app, "decision.header").waitForExistence(timeout: 30), "round \(round): the decision did not load")
            if round == 1 { keep(window.screenshot(), named: "n8-narrow-900-decision") }
            up("the decision, round \(round)")
            app.typeKey("[", modifierFlags: .command)
            XCTAssertTrue(needs.firstMatch.waitForExistence(timeout: 10), "round \(round): Back did not return to the decision list")
            let whatIf = element(app, "whatIf")
            reveal(whatIf, in: element(app, "detail.majorLeague.decision"))
            XCTAssertTrue(whatIf.waitForExistence(timeout: 10), "round \(round): the decision list offers no what-if")
            whatIf.click()
            // A reliever's what-if: the synthetic league's relievers have candidates behind them (the others' do not)
            let players = app.descendants(matching: .button).matching(NSPredicate(format: "identifier BEGINSWITH 'whatIf.player.'"))
            XCTAssertTrue(players.firstMatch.waitForExistence(timeout: 10), "round \(round): the what-if lists no player")
            let player = players.allElementsBoundByIndex.first { $0.label.contains("relief") } ?? players.firstMatch
            player.click()
            XCTAssertTrue(element(app, "decision.header").waitForExistence(timeout: 30), "round \(round): the what-if's decision did not load")
            let show = element(app, "decision.showCandidates")
            reveal(show, in: element(app, "detail.majorLeague.decision"))
            XCTAssertTrue(show.waitForExistence(timeout: 10), "round \(round): the what-if's decision has no candidates to show")
            show.click()
            let candidateTable = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'table.candidates.'")).firstMatch
            if !candidateTable.waitForExistence(timeout: 10) { keep(window.screenshot(), named: "n8-narrow-900-missing-candidates") }
            XCTAssertTrue(candidateTable.exists, "round \(round): the candidates' tables did not draw")
            let row = firstRow(of: candidateTable)
            XCTAssertTrue(row.waitForExistence(timeout: 10), "round \(round): the candidates' table has no row")
            leading(row)
            XCTAssertTrue(element(app, "row.detail").waitForExistence(timeout: 10), "round \(round): a candidate's detail did not draw")
            if round == 1 { keep(window.screenshot(), named: "n8-narrow-900-candidates") }
            element(app, "candidates.showDecision").click()
            XCTAssertTrue(element(app, "decision.header").waitForExistence(timeout: 10), "round \(round): the decision did not come back")
            up("the what-if, round \(round)")
            app.typeKey("[", modifierFlags: .command)
            XCTAssertTrue(needs.firstMatch.waitForExistence(timeout: 10), "round \(round): Back did not return to the decision list")
            app.typeKey("[", modifierFlags: .command)
            XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 10), "round \(round): Back did not return to the report")
            up("the report after the decisions, round \(round)")
        }
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n8-narrow")
        quitCleanly(app)
    }

    /// Following by drag (D-058): a club's name dragged from around the league onto the sidebar's Following section is
    /// followed (the server's answer redraws the section), and ⌘Z unfollows it again.
    @MainActor
    func testFollowByDrag() throws {
        let app = launch()
        waitForShell(app)
        app.typeKey("1", modifierFlags: .command)
        let wire = element(app, "morningReport.wire")
        XCTAssertTrue(wire.waitForExistence(timeout: 30), "around the league did not load")
        let target = element(app, "sidebar.following")
        XCTAssertTrue(target.waitForExistence(timeout: 10), "the sidebar has no Following section")
        let club = wire.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'club.'")).firstMatch
        XCTAssertTrue(club.waitForExistence(timeout: 10), "no club's name on the wire")
        let id = String(club.identifier.dropFirst("club.".count))
        // Around the league sits below the roster: scrolled into view, a step at a time
        let report = element(app, "detail.frontOffice.morningReport")
        for _ in 0..<12 where !club.isHittable { report.scroll(byDeltaX: 0, deltaY: -300) }
        XCTAssertTrue(club.isHittable, "the wire's club could not be scrolled into view")
        // A mouse drag (macOS's click-and-drag, not a trackpad's press), held over the section until it takes it
        club.click(forDuration: 0.4, thenDragTo: target, withVelocity: .slow, thenHoldForDuration: 0.8)
        let followed = element(app, "following.club.\(id)")
        XCTAssertTrue(followed.waitForExistence(timeout: 10), "the dropped club was not followed")
        keep(app.windows.firstMatch.screenshot(), named: "n7-followed-by-drag")
        // The pointer off the content (a help tag it left up covers text) and the report back at its top, as the GM
        // reads it, before the audit
        target.hover()
        report.scroll(byDeltaX: 0, deltaY: 5000)
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n7-following")
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(followed.waitForNonExistence(timeout: 10), "⌘Z did not unfollow the club")
        quitCleanly(app)
    }

    /// Search (D-059): ⌘K asks the server as the GM types, shows its groups, and Return on a club opens its report in its
    /// own window, audited.
    @MainActor
    func testSearchToClubWindow() throws {
        let app = launch()
        waitForShell(app)
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 30))
        app.typeKey("k", modifierFlags: .command)
        let query = element(app, "palette.query")
        XCTAssertTrue(query.waitForExistence(timeout: 5), "⌘K did not open the palette")
        query.click()
        query.typeText("club 3")
        let result = element(app, "palette.result.search.club.3")
        XCTAssertTrue(result.waitForExistence(timeout: 10), "the palette did not list the server's club")
        keep(app.windows.firstMatch.screenshot(), named: "n7-palette-search")
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n7-palette-search")
        query.typeKey(.return, modifierFlags: [])
        let window = element(app, "club.window.3")
        XCTAssertTrue(window.waitForExistence(timeout: 10), "Return did not open the club's window")
        XCTAssertTrue(element(app, "club.scouting").waitForExistence(timeout: 30), "the club's report did not load")
        keep(app.windows.firstMatch.screenshot(), named: "n7-club-window-from-search")
        try auditClubWindow(app, named: "accessibility-audit-n7-club-window")
        quitCleanly(app)
    }

    /// Audits a club's window on its own: the main window behind it closed (its covered text would be measured against
    /// the club window's pixels, and a minimised window stays in the tree) and the pointer off the content (a help tag it
    /// leaves up is the system's).
    @MainActor
    private func auditClubWindow(_ app: XCUIApplication, named name: String) throws {
        let main = app.windows.matching(NSPredicate(format: "identifier BEGINSWITH 'main'")).firstMatch
        if main.exists {
            // The main window brought to the front first, from the Window menu: on a small screen (GitHub's runner,
            // 1024 × 768) the club's window covers the main window's close button, and a click there reaches the club's
            raiseFromWindowMenu(app, main)
            main.buttons[XCUIIdentifierCloseWindow].firstMatch.click()
            XCTAssertTrue(main.waitForNonExistence(timeout: 5), "the main window did not close")
        }
        // The pointer is moved off the content, and any help tag waited away, by the audit itself
        try audit(app, named: name)
    }

    /// Brings a window to the front by its item in the Window menu (its title), and waits until it is the front window
    /// (the first in the app's list), so a click on its own controls reaches it. A click on a covered window's button
    /// would reach whatever covers it, and `isHittable` was seen true for one under another window on the runner.
    @MainActor
    private func raiseFromWindowMenu(_ app: XCUIApplication, _ window: XCUIElement) {
        let identifier = window.identifier
        let menu = app.menuBars.menuBarItems["Window"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5), "the menu bar has no Window menu")
        menu.click()
        // The menu lists each window by its title and subtitle ("Club Reports (May 6, 2040 · No log)", where the
        // window's own title reads "Club Reports – May 6, 2040 · No log"): the item that brings a window forward whose
        // title starts with the window's title before its subtitle
        let title = window.title
        let head = title.components(separatedBy: " – ").first ?? title
        XCTAssertTrue(menu.menuItems.firstMatch.waitForExistence(timeout: 5), "the Window menu did not open")
        let items = menu.menuItems.matching(identifier: "makeKeyAndOrderFront:").allElementsBoundByIndex
        let matches = items.filter { !head.isEmpty && $0.title.hasPrefix(head) }
        guard matches.count == 1, let item = matches.first else {
            return XCTFail("the Window menu lists \(matches.count) window(s) for '\(title)': \(items.map(\.title))")
        }
        item.click()
        let front = expectation(for: NSPredicate(format: "identifier == %@", identifier), evaluatedWith: app.windows.firstMatch)
        wait(for: [front], timeout: 5)
    }

    /// A club's window (D-059) from League Office ▸ Club Reports: the masthead, what our scouts see, head to head, the
    /// next series, moves and injuries as served; Follow in its toolbar, undone with ⌘Z. Audited in light and with
    /// Increase Contrast.
    @MainActor
    func testClubWindow() throws {
        let app = launch()
        waitForShell(app)
        let league = element(app, "sidebar.league")
        XCTAssertTrue(league.waitForExistence(timeout: 10))
        app.typeKey("8", modifierFlags: .command)
        let reports = element(app, "sidebar.league.clubReports")
        XCTAssertTrue(reports.waitForExistence(timeout: 10))
        reports.click()
        let open = element(app, "clubReports.open.2")
        XCTAssertTrue(open.waitForExistence(timeout: 20), "Club Reports lists no club")
        open.click()
        XCTAssertTrue(element(app, "club.window.2").waitForExistence(timeout: 10), "Open did not open the club's window")
        for part in ["club.scouting", "club.headToHead", "club.nextSeries", "club.moves", "club.injuries", "masthead"] {
            XCTAssertTrue(element(app, part).waitForExistence(timeout: 30), "the club's window has no \(part)")
        }
        keep(app.windows.firstMatch.screenshot(), named: "n7-club-window")
        let follow = element(app, "club.follow")
        XCTAssertTrue(follow.waitForExistence(timeout: 5))
        follow.click()
        // Followed: the main window's sidebar names it; ⌘Z in the club's window unfollows it again
        let followed = element(app, "following.club.2")
        XCTAssertTrue(followed.waitForExistence(timeout: 10), "Follow in the club's window did not follow it")
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(followed.waitForNonExistence(timeout: 10), "⌘Z did not unfollow the club")
        try auditClubWindow(app, named: "accessibility-audit-n7-club-window-light")
        quitCleanly(app)

        // The same window with Increase Contrast (the app's own pieces as the setting draws them)
        let contrast = launch(arguments: ["-PennantDebugAppearance", "increasedContrastLight"])
        waitForShell(contrast)
        contrast.typeKey("8", modifierFlags: .command)
        XCTAssertTrue(element(contrast, "sidebar.league.clubReports").waitForExistence(timeout: 10))
        element(contrast, "sidebar.league.clubReports").click()
        XCTAssertTrue(element(contrast, "clubReports.open.3").waitForExistence(timeout: 20))
        element(contrast, "clubReports.open.3").click()
        XCTAssertTrue(element(contrast, "club.scouting").waitForExistence(timeout: 30))
        keep(contrast.windows.firstMatch.screenshot(), named: "n7-club-window-increased-contrast")
        try auditClubWindow(contrast, named: "accessibility-audit-n7-club-window-increased-contrast")
        quitCleanly(contrast)
    }
}

/// A window's screenshot as pixels, to read an element's own contrast where the audit reports one (see `audit`).
struct WindowPixels {
    private let width: Int
    private let height: Int
    private let data: [UInt8]
    private let frame: CGRect
    /// Pixels per point: 2 on a Retina screen, 1 on GitHub's runner.
    let scale: CGFloat

    init?(_ image: NSImage, frame: CGRect) {
        guard frame.width > 0, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let w = cg.width, h = cg.height
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        width = w
        height = h
        data = bytes
        self.frame = frame
        scale = CGFloat(width) / frame.width
    }

    private static func channel(_ value: UInt8) -> Double {
        let v = Double(value) / 255
        return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    }

    /// The contrast of the element's text against its background, from its own pixels: its middle luminance (the
    /// background, which most of a text's frame is) against the tenth of its ink furthest from it (the strokes' cores:
    /// dark text on a light page, or light on dark), where its ink is the pixels that differ visibly from the background
    /// (more than 1.1:1), on the side most of them fall. Only the ink counts, so a frame wider than its words (a title
    /// strip, a wrapped line's empty end) reads its words, not its empty space. Every pixel blends the text's colour with
    /// the page's, so this never reads above the text's colours' own ratio. Nil when the frame is not in the picture.
    func contrast(in element: CGRect) -> Double? {
        let local = element.offsetBy(dx: -frame.minX, dy: -frame.minY)
        let x0 = max(0, Int((local.minX * scale).rounded(.down))), x1 = min(width, Int((local.maxX * scale).rounded(.up)))
        let y0 = max(0, Int((local.minY * scale).rounded(.down))), y1 = min(height, Int((local.maxY * scale).rounded(.up)))
        guard x1 > x0, y1 > y0 else { return nil }
        var values: [Double] = []
        values.reserveCapacity((x1 - x0) * (y1 - y0))
        for y in y0..<y1 {
            for x in x0..<x1 {
                let i = (y * width + x) * 4
                values.append(0.2126 * Self.channel(data[i]) + 0.7152 * Self.channel(data[i + 1]) + 0.0722 * Self.channel(data[i + 2]))
            }
        }
        values.sort()
        let middle = values[values.count / 2]
        func ratio(_ a: Double, _ b: Double) -> Double { (max(a, b) + 0.05) / (min(a, b) + 0.05) }
        let darker = values.filter { $0 < middle && ratio($0, middle) > 1.1 }
        let lighter = values.filter { $0 > middle && ratio($0, middle) > 1.1 }
        // Both sorted lightest last: dark ink's darkest tenth is near its start, light ink's lightest tenth near its end
        let text: Double
        if darker.count >= lighter.count {
            guard !darker.isEmpty else { return 1 }
            text = darker[darker.count / 10]
        } else {
            text = lighter[lighter.count - 1 - lighter.count / 10]
        }
        return ratio(text, middle)
    }
}
