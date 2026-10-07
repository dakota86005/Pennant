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
    /// Whether this test has launched the app yet (its first launch starts from fresh defaults).
    private var launchedThisTest = false
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
        // Independent of the test before it (PR #58 on the runner: a quit that did not finish left that app running past
        // its tear-down, writing its saved windows again, and the next tests found the keyboard elsewhere): no earlier
        // instance still running, and no saved windows, before anything is launched
        endEarlierInstances()
        removeSavedState()
        scratch = URL(fileURLWithPath: root).appending(path: methodName, directoryHint: .isDirectory)
        dataFolder = scratch.appending(path: "data", directoryHint: .isDirectory)
        guard FileManager.default.fileExists(atPath: dataFolder.appending(path: "league.db").path(percentEncoded: false)) else {
            XCTFail("macos/scripts/test.sh prepares \(scratch.path(percentEncoded: false)); add \(methodName) to its prepare_ui_test list")
            return
        }
    }

    /// A test of restoration leaves the app's saved windows behind if it fails midway: they are removed, so the next test
    /// (and the next run) opens without them (review L6). The app's own saved-state folder, under the real home; a runner
    /// that may not reach it leaves it, and `test.sh` removes it after the run as well.
    override func tearDownWithError() throws {
        removeSavedState()
    }

    /// The app's saved windows (its saved-state folder, under the real home), removed.
    private func removeSavedState() {
        guard let pw = getpwuid(getuid()), let home = pw.pointee.pw_dir else { return }
        let state = URL(fileURLWithPath: String(cString: home))
            .appending(path: "Library/Saved Application State/com.dakotawise.pennant.dev.savedState", directoryHint: .isDirectory)
        try? FileManager.default.removeItem(at: state)
    }

    /// The app this suite drives (its Debug build's identifier): any instance still running from an earlier test (one whose
    /// quit did not finish) is asked to quit, then ended if it has not within 20 seconds, so a test never starts beside it.
    private func endEarlierInstances() {
        let id = "com.dakotawise.pennant.dev"
        func running() -> [NSRunningApplication] { NSRunningApplication.runningApplications(withBundleIdentifier: id) }
        func waitForNone(_ seconds: TimeInterval) -> Bool {
            let deadline = Date.now.addingTimeInterval(seconds)
            while !running().isEmpty, Date.now < deadline { RunLoop.current.run(until: Date.now.addingTimeInterval(0.2)) }
            return running().isEmpty
        }
        guard !running().isEmpty else { return }
        print("[quit] \(methodName): an earlier instance of the app is still running; asking it to quit")
        running().forEach { $0.terminate() }
        if waitForNone(20) { return }
        running().forEach { $0.forceTerminate() }
        XCTAssertTrue(waitForNone(10), "an earlier instance of the app is still running")
    }

    // MARK: Helpers

    /// The pretend OOTP save `test.sh` put in the test's folder: the `.lg` folder with the synthetic league's export.
    private var save: URL {
        scratch.appending(path: "saves/Synthetic League.lg", directoryHint: .isDirectory)
    }

    @MainActor
    private func launch(arguments: [String] = [], environment: [String: String] = [:], restoresState: Bool = false) -> XCUIApplication {
        // The last launch has quit (`quitCleanly`) or is ended now, never left beside this one
        endEarlierInstances()
        let app = XCUIApplication()
        app.launchEnvironment["PENNANT_DEV_DATA_DIR"] = dataFolder.path(percentEncoded: false)
        app.launchEnvironment["PENNANT_DEV_LOG_DIR"] = scratch.appending(path: "logs").path(percentEncoded: false)
        // The app's own caches (the Morning Report kept across launches) in the test's folder, never the Mac's
        app.launchEnvironment["PENNANT_DEV_CACHES_DIR"] = scratch.appending(path: "caches").path(percentEncoded: false)
        for (name, value) in environment { app.launchEnvironment[name] = value }
        // A fresh window each time: no restored route from an earlier run; no notification permission asked of the Mac
        // running the tests (Pennant asks at the first export read while it is in front, L4)
        // (N11: a test of restoration keeps the windows open at quit and restores them at the next launch)
        let state = restoresState ? ["-ApplePersistenceIgnoreState", "NO", "-NSQuitAlwaysKeepsWindows", "YES"] : ["-ApplePersistenceIgnoreState", "YES"]
        // Each test's first launch starts from fresh app defaults (window frames, choices), so nothing an earlier test
        // left there reaches it; a test's later launches keep what its own first launch wrote
        let fresh = launchedThisTest ? [] : ["-PennantTestFreshDefaults", "YES"]
        launchedThisTest = true
        app.launchArguments += state + fresh + ["-PennantNotifiesNewExport", "NO"] + arguments
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
        // Key equivalents (⌘K, ⌘1…) go to the app in front; a launch that left Pennant behind another app is said and
        // brought forward (PR #58 on the runner: ⌘K and ⌘4 typed after a launch reached no Pennant window, while typing
        // into a clicked field, which brings the app forward, worked)
        if app.state != .runningForeground {
            print("[focus] \(methodName): Pennant was not in front after launch (state \(app.state.rawValue)); brought forward")
            app.activate()
            _ = app.wait(for: .runningForeground, timeout: 5)
        }
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
    /// - a contrast or description finding on an element of a served table that lies wholly or partly outside the visible
    ///   rectangle of the table's own scroll area (`ScrollClip`: the innermost scroll view holding the table in the
    ///   accessibility tree, inside its window, less its scroll bars), matched to the table through one snapshot of its
    ///   tree. A native table clips its rows and columns there, as Finder's list view does, and VoiceOver scrolls to
    ///   them; the audit measured pixels that are not theirs (PR #54 on the runner: the row under the detail pane, the
    ///   column past the trailing edge). Anything inside the rectangle fails as before (`ScrollClipTests`);
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
        // Each served table's own scroll area as the tree reports it: the innermost scroll view holding the table (or
        // the table itself when it is one), less its scroll bars, inside its window; and every element of the table,
        // from one snapshot, so an element is matched to its own table, never guessed from where it sits
        let tableClips: [(clip: ScrollClip, members: Set<ScrollClip.Member>)] = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'table.'")).allElementsBoundByIndex.compactMap { table in
                let area = table.elementType == .scrollView ? table
                    : app.scrollViews.containing(.any, identifier: table.identifier).allElementsBoundByIndex
                        .min { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
                guard let window = windows.first(where: { $0.frame.intersects(table.frame) })?.frame,
                      let snapshot = try? (area ?? table).snapshot() else { return nil }
                var members: Set<ScrollClip.Member> = []
                var bars: [CGRect] = []
                func walk(_ node: XCUIElementSnapshot, depth: Int) {
                    members.insert(ScrollClip.Member(node.elementType, node.frame))
                    // The scroll area's own scroll bars, not a scroll bar of something inside a row
                    if node.elementType == .scrollBar, depth == 1 { bars.append(node.frame) }
                    for child in node.children { walk(child, depth: depth + 1) }
                }
                walk(snapshot, depth: 0)
                return (ScrollClip(scrollArea: snapshot.frame, window: window, scrollBars: bars), members)
            }
        /// The scroll area clipping an element of a served table, when the element lies wholly or partly outside it.
        func clippingArea(_ element: XCUIElement, _ frame: CGRect) -> ScrollClip? {
            let key = ScrollClip.Member(element.elementType, frame)
            return tableClips.first { $0.members.contains(key) && $0.clip.clips(frame) }?.clip
        }
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
            } else if issue.auditType == .contrast || issue.auditType == .sufficientElementDescription,
                      let clip = clippingArea(element, frame) {
                // A row or column of a served table past its own scroll area's edge (under the detail pane, or past the
                // trailing edge on a narrow window): the native table clips it there and VoiceOver scrolls to it, and
                // what the audit measured on the screen is not its own. Only outside the visible rectangle measured from
                // the tree; a cell inside it fails as before (`ScrollClipTests`)
                setAside.append(line + " (clipped by its own table's scroll area, visible \(clip.visible))")
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
                let holder = windows.first { $0.frame.contains(frame) }
                let ratio = holder?.pixels?.contrast(in: frame)
                // Where no pixels were read, the windows as measured, so the line says why (PR #58: a finding with none)
                let unread = " (no pixels read: windows " + shots.map { "\($0.frame) pictured \(Int($0.shot.image.size.width))×\(Int($0.shot.image.size.height))" }
                    .joined(separator: ", ") + (holder == nil ? "; none holds it)" : "; its window's picture is not at one scale)")
                issues.append(line + (ratio.map { String(format: " (its own pixels read at %.1f:1)", $0) } ?? unread))
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

    /// Scrolls a list until the target lies wholly inside it, 20 points clear of either edge.
    @MainActor
    private func within(_ target: XCUIElement, in container: XCUIElement) {
        let leading = container.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5))
        for _ in 0..<10 {
            guard target.exists else { return }
            let (t, c) = (target.frame, container.frame)
            if t.minY >= c.minY + 20 && t.maxY <= c.maxY - 20 { return }
            leading.scroll(byDeltaX: 0, deltaY: t.minY < c.minY + 20 ? 120 : -120)
            _ = target.waitForExistence(timeout: 0.5)
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

    /// Scrolls a report to its top from its leading side (never its middle, which the inspector may cover) and waits
    /// until the element at its top stops moving, so nothing is measured mid-scroll.
    @MainActor
    private func reportAtTop(_ report: XCUIElement, top: XCUIElement) {
        let leading = report.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5))
        for _ in 0..<3 {
            leading.scroll(byDeltaX: 0, deltaY: 5000)
            var last = top.exists ? top.frame : .null
            var still = 0
            for _ in 0..<25 where still < 3 {
                _ = top.waitForExistence(timeout: 0.2)
                let now = top.exists ? top.frame : .null
                still = now == last ? still + 1 : 0
                last = now
            }
            if still >= 3 { return }
        }
        XCTFail("the report did not come to rest at its top")
    }

    /// ⌘Q, and the app gone within 20 seconds with its server stopped. ⌘Q goes to the app in front: one that is not (its
    /// last key window just closed) is brought forward first, and said in the log. A quit that does not finish says the
    /// app's state and windows; the app's own log (`logs/server.log`, kept by `test.sh`) says how far the quit went.
    /// The palette's field appeared after ⌘K; when it did not, the windows then are printed for the CI log (PR #58).
    @MainActor
    private func paletteOpened(_ app: XCUIApplication, _ query: XCUIElement) -> Bool {
        if query.waitForExistence(timeout: 5) { return true }
        let windows = app.windows.allElementsBoundByIndex.map { "\($0.identifier) \($0.frame) key=\($0.isHittable)" }
        print("[palette] \(methodName): no palette 5 s after ⌘K (state \(app.state.rawValue)); windows: \(windows)")
        return false
    }

    @MainActor
    private func quitCleanly(_ app: XCUIApplication) {
        if app.state != .runningForeground {
            print("[quit] \(methodName): the app was not in front (state \(app.state.rawValue)); brought forward for ⌘Q")
            app.activate()
        }
        app.typeKey("q", modifierFlags: .command)
        let ended = app.wait(for: .notRunning, timeout: 20)
        if !ended {
            let windows = app.windows.allElementsBoundByIndex.map { "\($0.identifier) \($0.frame)" }
            print("[quit] \(methodName): still running 20 s after ⌘Q (state \(app.state.rawValue)); windows: \(windows)")
            // Which process is it: the one that quit (its pid is in the app's log, "launch: this is process …"), or
            // another instance something launched as it went (PR #58 on the macOS 26 runner)
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.dakotawise.pennant.dev")
                .map { "pid \($0.processIdentifier) launched \($0.launchDate.map { "\($0)" } ?? "?") terminated \($0.isTerminated)" }
            print("[quit] \(methodName): Pennant processes now: \(running)")
        }
        XCTAssertTrue(ended, "the app did not quit within 20 s of ⌘Q; see \(scratch.path)/logs/server.log")
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
        XCTAssertTrue(paletteOpened(app, query), "⌘K did not open the palette")
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
        // text the GM reads there. Scrolled at its leading side and waited for until it is still (N12 Track B: the
        // intermittent finding, a report line just above the inspector's top edge, under the toolbar, read at 1.0:1).
        // A scroll at the report's middle lands on the inspector wherever the system lays it over the report's trailing
        // side, so the report stayed where the claim's click had scrolled it; and an audit taken while the scroll still
        // moved measured a line passing under the toolbar. Neither is the line's colour: the report is put at its top
        // and held still before the audit, so the set-aside for text under the inspector stays as narrow as it was.
        reportAtTop(element(app, "detail.frontOffice.morningReport"), top: element(app, "masthead"))
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
        // A native table on whatever window this is (on the runner's screen, about 1024 points): its scroll area lies
        // inside the window, columns past it scroll sideways inside it, and its first row's first cell is in its visible
        // rectangle, so the audit's scroll-area rule never excuses it
        let lineupArea = app.scrollViews.containing(.any, identifier: "table.lineup").allElementsBoundByIndex
            .min { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }?.frame ?? lineup.frame
        let mainWindow = app.windows.firstMatch.frame
        XCTAssertTrue(mainWindow.insetBy(dx: -1, dy: -1).contains(lineupArea), "the table's scroll area \(lineupArea) runs past the window \(mainWindow)")
        let firstCell = firstRow(of: lineup).staticTexts.firstMatch
        XCTAssertTrue(firstCell.waitForExistence(timeout: 10), "the table's first row has no text")
        XCTAssertFalse(ScrollClip(scrollArea: lineupArea, window: mainWindow).clips(firstCell.frame), "the first row's first cell \(firstCell.frame) is outside the table's visible rectangle")
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
            if !element(app, "row.detail").waitForExistence(timeout: 10) { keep(window.screenshot(), named: "n8-narrow-900-missing-candidate-detail") }
            XCTAssertTrue(element(app, "row.detail").exists, "round \(round): a candidate's detail did not draw")
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

    /// Every Major League Ops view at 900 × 700 with the inspector open (N9; BEHAVIOR_CASES.md "Pennant for Mac",
    /// `testClubhouseNarrowWindow`): the five N8 views and the seven clubhouse tools, round after round, a row chosen
    /// in each table, a lineup asked another way, a game's plan drawn beneath the schedule, the depth chart by position
    /// and by club, and each clubhouse tool audited on its first visit. Nothing may stop the app: the window's columns
    /// take no minimum from what they draw. One click on the sidebar draws its view (N9 review, M3: a second click
    /// hid a defect); the Lineup's table keeps at least `TablePane.tableMinimum` (120 pt) of height (M1).
    @MainActor
    func testClubhouseNarrowWindow() throws {
        let app = launch(arguments: ["-PennantDebugWindowSize", "900x700", "-PennantDebugInspector", "YES"])
        waitForShell(app)
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 30), "⌘2 did not open Major League Ops")
        let window = app.windows.firstMatch
        let narrow = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in window.frame.width <= 905 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [narrow], timeout: 15), .completed, "the window did not take the narrow size")
        XCTAssertTrue(element(app, "inspector").waitForExistence(timeout: 10), "the inspector is not open")
        // Running is what matters here (a crash stops it). Only when another process has taken the front (a test run
        // beside this one draws its own windows) is the app brought back, and that is logged (N9 review, M3)
        let up = { (step: String) in
            XCTAssertTrue([.runningForeground, .runningBackground].contains(app.state), "the app stopped at \(step)")
            let front = NSWorkspace.shared.frontmostApplication
            if let front, !["com.dakotawise.pennant", "com.dakotawise.pennant.dev"].contains(front.bundleIdentifier ?? "") {
                let note = "[narrow] \(front.localizedName ?? front.bundleIdentifier ?? "another process") was frontmost at \(step); Pennant brought back"
                print(note)
                XCTContext.runActivity(named: note) { _ in }
                app.activate()
                _ = app.wait(for: .runningForeground, timeout: 5)
            }
        }
        let leading = { (target: XCUIElement) in target.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).click() }
        // Each view, and what shows it drew: a table (a row is chosen in it) or another element
        let views: [(view: String, shows: String, table: Bool)] = [
            ("report", "report.content", false), ("positionPlayers", "table.lineup", true), ("pitchingStaff", "table.pitching.0", true),
            ("benchBackups", "table.bench", true), ("decision", "detail.majorLeague.decision", false), ("lineup", "table.lineup.order", true),
            ("pitchingAvailability", "table.pitchingAvailability.bullpen", true), ("scheduleGamePlans", "table.schedule.games", true),
            ("depthChart", "depthChart.mode", false), ("fortyManOptions", "table.fortyMan.fortyMan", true), ("rosters", "table.rosters.hitters", true),
            ("seasonTrends", "trend.differential", false),
        ]
        let clubhouse: Set<String> = ["lineup", "pitchingAvailability", "scheduleGamePlans", "depthChart", "fortyManOptions", "rosters", "seasonTrends"]
        for round in 1...3 {
            for view in views {
                let item = element(app, "sidebar.majorLeague.\(view.view)")
                let sidebar = element(app, "sidebar")
                up("before \(view.view), round \(round)")
                if !item.isHittable { reveal(item, in: sidebar) }
                XCTAssertTrue(item.waitForExistence(timeout: 10), "round \(round): the sidebar has no \(view.view)")
                // Wholly inside the sidebar before the click, so XCTest has no scrolling of its own to do (its
                // scroll-to-visible found no hit point for the sidebar's list mid-run, a test-side failure)
                within(item, in: sidebar)
                // A click on a window in the background only brings it forward: the app is in front first
                up("before \(view.view), round \(round)")
                item.click()
                let shown = element(app, view.shows)
                // One click draws the view: no second click (N9 review, M3)
                if !shown.waitForExistence(timeout: 30) { keep(window.screenshot(), named: "n9-narrow-900-missing-\(view.view)") }
                XCTAssertTrue(shown.exists, "round \(round): \(view.view) did not draw")
                if view.table {
                    let row = firstRow(of: shown)
                    XCTAssertTrue(row.waitForExistence(timeout: 10), "round \(round): \(view.view)'s table has no row")
                    leading(row)
                }
                switch view.view {
                case "lineup":
                    // The table keeps its height at 900 × 700 with the inspector open (M1)
                    XCTAssertGreaterThanOrEqual(shown.frame.height, 120, "round \(round): the lineup's table is \(shown.frame.height) pt tall")
                    // The card against left-handers, asked of the server from the toolbar and drawn
                    let hand = element(app, "lineup.choice.0").radioButtons.element(boundBy: 1)
                    XCTAssertTrue(hand.waitForExistence(timeout: 10), "round \(round): the lineup offers no choice of hand")
                    hand.click()
                    XCTAssertTrue(element(app, "table.lineup.order").waitForExistence(timeout: 20), "round \(round): the card asked another way did not draw")
                case "scheduleGamePlans":
                    XCTAssertTrue(element(app, "schedule.plan").waitForExistence(timeout: 20), "round \(round): the chosen game's plan did not draw")
                case "depthChart":
                    // By position: a table of one position across the organization, a row chosen; then by club, and back
                    let mode = element(app, "depthChart.mode").radioButtons
                    if mode.element(boundBy: 0).isSelected == false { mode.element(boundBy: 0).click() }
                    let table = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'table.depthChart.'")).firstMatch
                    XCTAssertTrue(table.waitForExistence(timeout: 10), "round \(round): the depth by position did not draw")
                    let row = firstRow(of: table)
                    XCTAssertTrue(row.waitForExistence(timeout: 10), "round \(round): the depth by position has no row")
                    leading(row)
                    mode.element(boundBy: 1).click()
                    XCTAssertTrue(element(app, "depthChart.field").waitForExistence(timeout: 10) || element(app, "depthChart.club").exists,
                                  "round \(round): the depth by club did not draw")
                    mode.element(boundBy: 0).click()
                    XCTAssertTrue(table.waitForExistence(timeout: 10), "round \(round): the depth by position did not come back")
                case "rosters":
                    let pitchers = element(app, "rosters.sections").radioButtons.element(boundBy: 1)
                    if pitchers.exists {
                        pitchers.click()
                        XCTAssertTrue(element(app, "table.rosters.pitchers").waitForExistence(timeout: 10), "round \(round): the pitchers did not draw")
                    }
                default:
                    break
                }
                if round == 1 { keep(window.screenshot(), named: "n9-narrow-900-\(view.view)") }
                up("\(view.view), round \(round)")
                if round == 1, clubhouse.contains(view.view) {
                    try audit(app, named: "accessibility-audit-n9-narrow-\(view.view)")
                }
            }
        }
        quitCleanly(app)
    }

    /// League Office's and Scouting's views at 900 × 700 with the inspector open (N12 Track B; BEHAVIOR_CASES.md "Pennant
    /// for Mac", `testLeagueOfficeNarrowWindow`): Standings, Leaders, Org Comparison, Franchise History, Us vs Them, the
    /// Draft Board and Player Search, round after round, a row chosen in each table, another division, category and
    /// opponent asked, the franchise's seasons and record, a search typed, and each view audited on its first visit.
    /// Nothing may stop the app, and every table keeps at least `TablePane.tableMinimum` (120 pt) of height.
    @MainActor
    func testLeagueOfficeNarrowWindow() throws {
        let app = launch(arguments: ["-PennantDebugWindowSize", "900x700", "-PennantDebugInspector", "YES"])
        waitForShell(app)
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 30), "the Morning Report did not load")
        let window = app.windows.firstMatch
        let narrow = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in window.frame.width <= 905 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [narrow], timeout: 15), .completed, "the window did not take the narrow size")
        XCTAssertTrue(element(app, "inspector").waitForExistence(timeout: 10), "the inspector is not open")
        let up = { (step: String) in
            XCTAssertTrue([.runningForeground, .runningBackground].contains(app.state), "the app stopped at \(step)")
            let front = NSWorkspace.shared.frontmostApplication
            if let front, !["com.dakotawise.pennant", "com.dakotawise.pennant.dev"].contains(front.bundleIdentifier ?? "") {
                let note = "[narrow] \(front.localizedName ?? front.bundleIdentifier ?? "another process") was frontmost at \(step); Pennant brought back"
                print(note)
                XCTContext.runActivity(named: note) { _ in }
                app.activate()
                _ = app.wait(for: .runningForeground, timeout: 5)
            }
        }
        let leading = { (target: XCUIElement) in target.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).click() }
        let starting = { (prefix: String) in
            app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
        }
        // Each view, and what shows it drew: a served table (identifier prefix; a row is chosen in it) or another element
        let views: [(dept: String, view: String, shows: String, table: Bool)] = [
            ("league", "standings", "table.standings.", true), ("league", "leaders", "table.leaders.", true),
            ("league", "orgComparison", "table.orgComparison.clubs", true), ("league", "franchiseHistory", "franchise.part", false),
            ("league", "usVsThem", "table.usVsThem.", true), ("scouting", "draftBoard", "table.draftBoard.board", true),
            ("scouting", "playerSearch", "table.playerSearch.results.", true),
        ]
        for round in 1...3 {
            for view in views {
                let item = element(app, "sidebar.\(view.dept).\(view.view)")
                let sidebar = element(app, "sidebar")
                up("before \(view.view), round \(round)")
                if !item.exists {
                    // The department folded: the Go menu opens it (⌘4 Scouting, ⌘8 League Office), unfolding its views
                    app.typeKey(view.dept == "scouting" ? "4" : "8", modifierFlags: .command)
                    if !item.waitForExistence(timeout: 10) { keep(window.screenshot(), named: "n12b-narrow-900-folded-\(view.dept)") }
                }
                if !item.isHittable { reveal(item, in: sidebar) }
                XCTAssertTrue(item.waitForExistence(timeout: 10), "round \(round): the sidebar has no \(view.view)")
                within(item, in: sidebar)
                up("before \(view.view), round \(round)")
                // At the row's leading side, inside the sidebar: XCTest's own scroll-to-visible found no hit point for the
                // sidebar's list mid-run (as N9's test saw), so nothing is left for it to scroll
                leading(item)
                let shown = starting(view.shows)
                if !shown.waitForExistence(timeout: 15) {
                    // The sidebar can move under the click while a department unfolds (the click lands on the row above):
                    // once more, with the row at rest
                    print("[narrow] \(view.view) did not draw after the first click, round \(round); clicked again")
                    up("again before \(view.view), round \(round)")
                    within(item, in: sidebar)
                    leading(item)
                }
                if !shown.waitForExistence(timeout: 30) { keep(window.screenshot(), named: "n12b-narrow-900-missing-\(view.view)") }
                XCTAssertTrue(shown.exists, "round \(round): \(view.view) did not draw")
                if view.table {
                    XCTAssertGreaterThanOrEqual(shown.frame.height, 120, "round \(round): \(view.view)'s table is \(shown.frame.height) pt tall")
                    let row = firstRow(of: shown)
                    XCTAssertTrue(row.waitForExistence(timeout: 10), "round \(round): \(view.view)'s table has no row")
                    leading(row)
                    if !element(app, "row.detail").waitForExistence(timeout: 10) {
                        keep(window.screenshot(), named: "n12b-narrow-900-no-detail-\(view.view)")
                        print("[narrow] no detail on \(view.view), round \(round); windows: \(app.windows.allElementsBoundByIndex.map { "\($0.identifier) '\($0.title)'" })")
                    }
                    XCTAssertTrue(element(app, "row.detail").exists, "round \(round): \(view.view)'s row showed no detail")
                }
                switch view.view {
                case "franchiseHistory":
                    // The record's chart, then every season as a table, and back to the record
                    let parts = element(app, "franchise.part").radioButtons
                    parts.element(boundBy: 0).click()
                    XCTAssertTrue(element(app, "franchise.chart").waitForExistence(timeout: 10), "round \(round): the record chart did not draw")
                    parts.element(boundBy: 1).click()
                    let seasons = element(app, "table.franchise.seasons")
                    XCTAssertTrue(seasons.waitForExistence(timeout: 10), "round \(round): the seasons did not draw")
                    XCTAssertGreaterThanOrEqual(seasons.frame.height, 120, "round \(round): the seasons' table is \(seasons.frame.height) pt tall")
                    leading(firstRow(of: seasons))
                case "usVsThem":
                    // Another club, asked of the server and drawn
                    let menu = element(app, "usVsThem.opponent")
                    if menu.waitForExistence(timeout: 5) {
                        menu.click()
                        let other = element(app, "usVsThem.opponent.1")
                        if other.waitForExistence(timeout: 5) { other.click() } else { app.typeKey(.escape, modifierFlags: []) }
                        XCTAssertTrue(starting("table.usVsThem.").waitForExistence(timeout: 20), "round \(round): another opponent did not draw")
                    }
                case "standings":
                    XCTAssertTrue(element(app, "standings.division").exists, "round \(round): Standings offers no division")
                case "draftBoard":
                    // The published class (N12 Track B review, M8): the chosen prospect's reasons, read when he was chosen
                    let reasons = element(app, "row.detail").descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "points of it is still projection", "points of it is still projection")).firstMatch
                    if !reasons.waitForExistence(timeout: 15) { keep(window.screenshot(), named: "n12b-narrow-900-no-reasons") }
                    XCTAssertTrue(reasons.exists, "round \(round): the chosen prospect's reasons did not draw")
                case "playerSearch":
                    // A name typed in the window's search field (scoped to Player Search) is asked of the server, and the
                    // results drawn again: a few rows, so the audit below reads a short table (300 rows of season lines
                    // made each audit element's lookup take most of a second)
                    let field = app.searchFields.firstMatch
                    XCTAssertTrue(field.waitForExistence(timeout: 5), "round \(round): no search field")
                    field.click()
                    field.typeKey("a", modifierFlags: .command)
                    field.typeText("1054")
                    let narrowed = starting("table.playerSearch.results.")
                    XCTAssertTrue(narrowed.waitForExistence(timeout: 20), "round \(round): the search did not draw")
                    let fewer = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in narrowed.tableRows.count + narrowed.outlineRows.count < 20 }, object: nil)
                    XCTAssertEqual(XCTWaiter.wait(for: [fewer], timeout: 20), .completed, "round \(round): the search did not narrow the results")
                default:
                    break
                }
                if round == 1 { keep(window.screenshot(), named: "n12b-narrow-900-\(view.view)") }
                up("\(view.view), round \(round)")
                if round == 1 {
                    // The view at rest before it is measured: nothing still being read (a view drawn as updating fades
                    // its rows while the newer payload lands, run 3 of the first five), and the window in front
                    let busy = app.progressIndicators.firstMatch
                    if busy.exists { _ = busy.waitForNonExistence(timeout: 20) }
                    up("audit of \(view.view)")
                    try audit(app, named: "accessibility-audit-n12b-narrow-\(view.view)")
                }
                if view.view == "playerSearch" {
                    let field = app.searchFields.firstMatch
                    field.click()
                    field.typeKey("a", modifierFlags: .command)
                    field.typeKey(.delete, modifierFlags: [])
                }
            }
        }
        quitCleanly(app)
    }

    /// Player Search's whole first page (up to 300 rows of season lines; every batter on the synthetic league) audited once,
    /// as the GM first sees it (N12 Track B review, L10). On its own: the audit reads every row's cells, about nine minutes,
    /// too long for the narrow test's rounds, which audit it on a narrowed search.
    @MainActor
    func testPlayerSearchFullPageAudit() throws {
        let app = launch(arguments: ["-PennantDebugWindowSize", "900x700", "-PennantDebugInspector", "YES"])
        waitForShell(app)
        app.typeKey("4", modifierFlags: .command)
        let item = element(app, "sidebar.scouting.playerSearch")
        let sidebar = element(app, "sidebar")
        XCTAssertTrue(item.waitForExistence(timeout: 30), "the sidebar has no Player Search")
        if !item.isHittable { reveal(item, in: sidebar) }
        within(item, in: sidebar)
        item.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).click()
        let table = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "table.playerSearch.results.")).firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 30), "Player Search did not draw")
        // The whole first page as served (on the synthetic league, every batter it has: fewer than 300)
        let full = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in table.tableRows.count + table.outlineRows.count >= 50 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [full], timeout: 30), .completed, "Player Search did not show its first page")
        print("[audit] Player Search's first page: \(table.tableRows.count + table.outlineRows.count) rows")
        let busy = app.progressIndicators.firstMatch
        if busy.exists { _ = busy.waitForNonExistence(timeout: 20) }
        keep(app.windows.firstMatch.screenshot(), named: "n12b-player-search-300")
        try audit(app, named: "accessibility-audit-n12b-playerSearch-300")
        quitCleanly(app)
    }

    /// The clubhouse tools at 1280 × 820, the size the GM most often uses (N9 review): each view drawn, a row chosen in
    /// its table, captured in the light theme (`testClubhouseWideWindowDark` in the dark one).
    @MainActor
    func testClubhouseWideWindow() throws { try clubhouseWide(named: "n9-1280") }

    @MainActor
    func testClubhouseWideWindowDark() throws { try clubhouseWide(named: "n9-1280-dark") }

    @MainActor
    private func clubhouseWide(named prefix: String) throws {
        let app = launch(arguments: ["-PennantDebugWindowSize", "1280x820"])
        waitForShell(app)
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 30), "⌘2 did not open Major League Ops")
        let window = app.windows.firstMatch
        let views: [(view: String, shows: String, table: Bool)] = [
            ("lineup", "table.lineup.order", true), ("pitchingAvailability", "table.pitchingAvailability.bullpen", true),
            ("scheduleGamePlans", "table.schedule.games", true), ("depthChart", "depthChart.mode", false),
            ("fortyManOptions", "table.fortyMan.fortyMan", true), ("rosters", "table.rosters.hitters", true), ("seasonTrends", "trend.differential", false),
        ]
        for view in views {
            let item = element(app, "sidebar.majorLeague.\(view.view)")
            if !item.isHittable { reveal(item, in: element(app, "sidebar")) }
            XCTAssertTrue(item.waitForExistence(timeout: 10), "the sidebar has no \(view.view)")
            item.click()
            let shown = element(app, view.shows)
            XCTAssertTrue(shown.waitForExistence(timeout: 30), "\(view.view) did not draw")
            if view.table {
                let row = firstRow(of: shown)
                if row.waitForExistence(timeout: 10) { row.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).click() }
            }
            if view.view == "depthChart" {
                let table = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'table.depthChart.'")).firstMatch
                XCTAssertTrue(table.waitForExistence(timeout: 10), "the depth by position did not draw")
                keep(window.screenshot(), named: "\(prefix)-depthChart-by-position")
                element(app, "depthChart.mode").radioButtons.element(boundBy: 1).click()
                // The field where there is room, the positions as cards where there is not: the club's view either way
                XCTAssertTrue(element(app, "depthChart.club").waitForExistence(timeout: 10), "the depth by club did not draw")
            }
            keep(window.screenshot(), named: "\(prefix)-\(view.view)")
        }
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
        XCTAssertTrue(paletteOpened(app, query), "⌘K did not open the palette")
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

    /// Farm & Development (N10): a farm item in the report opens where the farm answers it (the synthetic league's first
    /// is about its affiliate, Farm 1 F, so Affiliates opens on that club), an assignment's row opens its Decision on a
    /// double-click with the cascade drawn as a chain that stops and its open hole as information, and every farm view
    /// draws and passes the audit, in light and dark.
    @MainActor
    func testFarmDeskToDecision() throws {
        let app = launch()
        waitForShell(app)
        app.typeKey("3", modifierFlags: .command)
        XCTAssertTrue(element(app, "report.content").waitForExistence(timeout: 30), "the farm's report did not load")
        let open = element(app, "item.open")
        XCTAssertTrue(open.waitForExistence(timeout: 10), "no farm item opens where the farm answers it")
        open.click()
        XCTAssertTrue(element(app, "farm.affiliates.clubs").waitForExistence(timeout: 30), "Open did not open Affiliates")
        XCTAssertTrue(element(app, "farm.affiliate.101").waitForExistence(timeout: 10), "Affiliates did not open on the item's club")
        keep(app.windows.firstMatch.screenshot(), named: "n10-farm-opened-from-report")
        sidebarAtTop(app)
        try audit(app, named: "accessibility-audit-n10-farm-opened")

        // Assignments: the table, the in-question filter, and a double-click into a Decision
        element(app, "sidebar.farm.assignments").click()
        let table = element(app, "table.farm.assignments")
        XCTAssertTrue(table.waitForExistence(timeout: 20), "Assignments did not load")
        element(app, "farm.filter.inQuestion").click()
        let row = firstRow(of: table)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Assignments lists no player")
        keep(app.windows.firstMatch.screenshot(), named: "n10-farm-assignments")
        try audit(app, named: "accessibility-audit-n10-farm-assignments")
        // A cell on the screen (the audit may leave the table scrolled sideways; the row runs past its edge)
        (row.cells.allElementsBoundByIndex.first { $0.isHittable } ?? row).doubleClick()
        XCTAssertTrue(element(app, "farm.decision.head").waitForExistence(timeout: 30), "a double-click did not open the player's Decision")
        // Every synthetic farm player's departure leaves his club a hole no one fills: the chain stops, and says so
        XCTAssertTrue(element(app, "farm.cascade").waitForExistence(timeout: 10), "the Decision drew no cascade")
        XCTAssertTrue(element(app, "farm.cascade.stop").exists, "the cascade states no stop")
        XCTAssertTrue(element(app, "farm.cascade.open").exists, "the cascade's open hole is not shown as information")
        keep(app.windows.firstMatch.screenshot(), named: "n10-farm-decision")
        try audit(app, named: "accessibility-audit-n10-farm-decision")
        // Back returns to the table
        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(table.waitForExistence(timeout: 10), "Back did not return to Assignments")

        // Every other view draws and passes
        for (view, ready) in [("organization", "farm.organization.depth"), ("affiliates", "farm.affiliates.clubs"),
                              ("prospects", "table.farm.prospects"), ("developmentTracking", "table.farm.development")] {
            element(app, "sidebar.farm.\(view)").click()
            XCTAssertTrue(element(app, ready).waitForExistence(timeout: 30), "Farm ▸ \(view) did not draw")
            keep(app.windows.firstMatch.screenshot(), named: "n10-farm-\(view)")
            try audit(app, named: "accessibility-audit-n10-farm-\(view)")
        }
        quitCleanly(app)
    }

    /// The narrow window for the farm (the N10 review, H1 and M4): 900 × 700 with the inspector open, where the farm's
    /// tables beside their panes clipped the content on both sides (or crashed AppKit before the panes gave way). Every
    /// farm view in turn, a row chosen in each table and what goes with it drawn beneath, a Decision opened from
    /// Assignments with its cascade and its results fold, and the Decision list, three rounds: the app stays up, each
    /// table and pane lies inside the window (nothing cut off at either side), and the open fold covers nothing after it.
    @MainActor
    func testFarmNarrowWindow() throws {
        let app = launch(arguments: ["-PennantDebugWindowSize", "900x700", "-PennantDebugInspector", "YES"])
        waitForShell(app)
        app.typeKey("3", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.farm.report").waitForExistence(timeout: 30), "⌘3 did not open Farm & Development")
        let window = app.windows.firstMatch
        let narrow = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in window.frame.width <= 905 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [narrow], timeout: 15), .completed, "the window did not take the narrow size")
        XCTAssertTrue(element(app, "inspector").waitForExistence(timeout: 10), "the inspector is not open")
        let up = { (step: String) in XCTAssertEqual(app.state, .runningForeground, "the app stopped at \(step)") }
        // Inside the window, both sides: the review found the content run past the window's leading and trailing edges
        let inside = { (target: XCUIElement, step: String) in
            let frame = target.frame, bounds = window.frame
            XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1, "\(step) starts left of the window")
            XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1, "\(step) runs past the window's right edge")
            XCTAssertGreaterThan(frame.width, 0, "\(step) has no width")
        }
        // Clicks aimed at an element's leading side: on a window this narrow the system lays the inspector over the
        // content's trailing side, and a click at a wide element's middle would land on the inspector
        let leading = { (target: XCUIElement) in target.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)) }
        let affiliate = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'farm\\.affiliate\\.[0-9]+'")).firstMatch
        let views: [(view: String, ready: String, table: Bool, detail: String?)] = [
            ("organization", "farm.organization.depth", false, nil),
            ("affiliates", "farm.affiliates.clubs", false, nil),
            ("assignments", "table.farm.assignments", true, "farm.assignments.detail"),
            ("prospects", "table.farm.prospects", true, "farm.prospects.detail"),
            ("developmentTracking", "table.farm.development", true, "farm.development.detail"),
        ]
        keep(window.screenshot(), named: "n10-narrow-900-report")
        for round in 1...3 {
            for view in views {
                let item = element(app, "sidebar.farm.\(view.view)")
                XCTAssertTrue(item.waitForExistence(timeout: 10), "round \(round): the sidebar has no \(view.view)")
                item.click()
                let ready = element(app, view.ready)
                if !ready.waitForExistence(timeout: 20) { keep(window.screenshot(), named: "n10-narrow-900-missing-\(view.view)") }
                XCTAssertTrue(ready.exists, "round \(round): \(view.view) did not draw")
                inside(ready, "round \(round): \(view.view)")
                if view.table {
                    let row = firstRow(of: ready)
                    // Assignments opens on those in question; the synthetic farm has none, so every player is shown (kept
                    // by the window from then on)
                    if view.view == "assignments", !row.waitForExistence(timeout: 5) {
                        let filter = element(app, "farm.filter.inQuestion")
                        if !filter.exists { keep(window.screenshot(), named: "n10-narrow-900-no-filter") }
                        XCTAssertTrue(filter.exists, "round \(round): Assignments' filter is not in the toolbar")
                        filter.click()
                    }
                    // Prospects opens on the development meetings; the synthetic farm has none, so All
                    if view.view == "prospects", !row.waitForExistence(timeout: 5) {
                        let filter = element(app, "farm.filter.prospects")
                        XCTAssertTrue(filter.exists, "round \(round): Prospects' filter is not in the toolbar")
                        filter.click()
                        // The served label carries its count ("All · 6")
                        let all = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'All ·'")).firstMatch
                        XCTAssertTrue(all.waitForExistence(timeout: 5), "round \(round): Prospects' filter offers no All")
                        all.click()
                    }
                    // Development tracking lists the players with a history in this save, which a new synthetic save
                    // may not have yet: then its served sentence, and nothing to choose
                    let rows = view.view != "developmentTracking" || row.waitForExistence(timeout: 5)
                    if rows {
                        XCTAssertTrue(row.waitForExistence(timeout: 10), "round \(round): \(view.view)'s table has no row")
                        leading(row).click()
                    }
                }
                if let detail = view.detail, view.view != "developmentTracking" || firstRow(of: ready).exists {
                    let pane = element(app, detail)
                    XCTAssertTrue(pane.waitForExistence(timeout: 10), "round \(round): \(view.view)'s chosen row drew nothing beneath")
                    inside(pane, "round \(round): \(view.view)'s detail")
                }
                if view.view == "affiliates" {
                    XCTAssertTrue(affiliate.waitForExistence(timeout: 10), "round \(round): no affiliate is read beneath the organization")
                    inside(affiliate, "round \(round): the affiliate")
                }
                if round == 1 { keep(window.screenshot(), named: "n10-narrow-900-\(view.view)") }
                up("\(view.view), round \(round)")
            }
            // A Decision from Assignments (in question only, as it opens): its cascade drawn, its results fold opened
            // over nothing, and Back
            element(app, "sidebar.farm.assignments").click()
            let table = element(app, "table.farm.assignments")
            XCTAssertTrue(table.waitForExistence(timeout: 20), "round \(round): Assignments did not load")
            let row = firstRow(of: table)
            XCTAssertTrue(row.waitForExistence(timeout: 10), "round \(round): Assignments lists no player")
            leading(row).doubleClick()
            let head = element(app, "farm.decision.head")
            if !head.waitForExistence(timeout: 30) {
                keep(window.screenshot(), named: "n10-narrow-900-missing-decision")
            }
            XCTAssertTrue(head.exists, "round \(round): a double-click did not open the player's Decision")
            inside(head, "round \(round): the Decision's head")
            let page = element(app, "detail.farm.decision")
            let section2 = element(app, "farm.decision.section.2"), section3 = element(app, "farm.decision.section.3")
            XCTAssertTrue(section2.exists && section3.exists, "round \(round): the Decision has no second or third section")
            inside(section2, "round \(round): what Player Development says")
            let fold = section2.disclosureTriangles.firstMatch
            XCTAssertTrue(fold.exists, "round \(round): the results fold is not there")
            // Scrolled into the window (the page is long at this width), so the click lands on it
            let onPage = page.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.6))
            for _ in 0..<20 where fold.frame.maxY > window.frame.maxY - 40 || fold.frame.minY < window.frame.minY + 80 {
                onPage.scroll(byDeltaX: 0, deltaY: fold.frame.maxY > window.frame.maxY - 40 ? -300 : 300)
                _ = fold.waitForExistence(timeout: 0.5)
            }
            if element(app, "farm.decision.results").exists == false { fold.click() }
            let results = element(app, "farm.decision.results")
            if !results.waitForExistence(timeout: 10) {
                keep(window.screenshot(), named: "n10-narrow-900-missing-results")
            }
            XCTAssertTrue(results.exists, "round \(round): the results fold did not open")
            XCTAssertLessThanOrEqual(results.frame.maxY, section3.frame.minY + 1, "round \(round): the open fold covers section 3")
            inside(results, "round \(round): the results")
            if round == 1 { keep(window.screenshot(), named: "n10-narrow-900-decision") }
            let cascade = element(app, "farm.cascade")
            XCTAssertTrue(cascade.exists, "round \(round): the Decision drew no cascade")
            reveal(element(app, "farm.cascade.stop"), in: page)
            XCTAssertTrue(element(app, "farm.cascade.stop").exists, "round \(round): the cascade states no stop")
            XCTAssertTrue(element(app, "farm.cascade.open").exists, "round \(round): the cascade's open hole is not shown as information")
            inside(element(app, "farm.cascade.stop"), "round \(round): the cascade's stop")
            if round == 1 { keep(window.screenshot(), named: "n10-narrow-900-cascade") }
            up("the Decision, round \(round)")
            app.typeKey("[", modifierFlags: .command)
            XCTAssertTrue(table.waitForExistence(timeout: 10), "round \(round): Back did not return to Assignments")
            // The Decision list, opened on its own
            element(app, "sidebar.farm.decision").click()
            let index = element(app, "table.farm.decision")
            XCTAssertTrue(index.waitForExistence(timeout: 20), "round \(round): the Decision list did not draw")
            inside(index, "round \(round): the Decision list")
            if round == 1 { keep(window.screenshot(), named: "n10-narrow-900-decision-list") }
            up("the Decision list, round \(round)")
        }
        quitCleanly(app)
    }

    /// Farm & Development in dark: the views the GM reads longest, audited.
    @MainActor
    func testFarmViewsDark() throws {
        let app = launch()
        waitForShell(app)
        app.typeKey("3", modifierFlags: .command)
        XCTAssertTrue(element(app, "report.content").waitForExistence(timeout: 30), "the farm's report did not load")
        for (view, ready) in [("affiliates", "farm.affiliates.clubs"), ("assignments", "table.farm.assignments"), ("prospects", "table.farm.prospects")] {
            element(app, "sidebar.farm.\(view)").click()
            XCTAssertTrue(element(app, ready).waitForExistence(timeout: 30), "Farm ▸ \(view) did not draw")
            // The GM's focus in the view, as after reading it (the sidebar's focused selection is the system's accent,
            // which the shell's own tests reach by ⌘-number, never by a click left in the sidebar)
            // (a table's first row or the first affiliate; a table's own frame runs under the sidebar, so never its corner)
            if view == "affiliates" {
                app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'farm.club.'")).element(boundBy: 1).click()
            } else {
                let row = firstRow(of: element(app, ready))
                // The synthetic farm has nobody in question and no meeting: every player, as the GM would ask
                if !row.waitForExistence(timeout: 5) {
                    if view == "assignments" {
                        element(app, "farm.filter.inQuestion").click()
                    } else {
                        element(app, "farm.filter.prospects").click()
                        let all = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'All ·'")).firstMatch
                        XCTAssertTrue(all.waitForExistence(timeout: 5), "Prospects' filter offers no All")
                        all.click()
                    }
                }
                XCTAssertTrue(row.waitForExistence(timeout: 10), "Farm ▸ \(view) lists no player")
                (row.cells.allElementsBoundByIndex.first { $0.isHittable } ?? row).click()
            }
            keep(app.windows.firstMatch.screenshot(), named: "n10-farm-\(view)-dark")
            try audit(app, named: "accessibility-audit-n10-farm-\(view)-dark")
        }
        quitCleanly(app)
    }

    // MARK: The player window and Compare (N11)

    /// The player windows open, as the identifier of his window says, and no more than one per player.
    @MainActor
    private func playerWindows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.windows.matching(NSPredicate(format: "identifier BEGINSWITH 'player.window.' OR identifier BEGINSWITH 'Player'"))
    }

    /// Brings a window to the front with ⌘` (the app's own window cycling), until it is the front window.
    @MainActor
    private func bringForward(_ app: XCUIApplication, _ window: XCUIElement) {
        let front = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            if app.windows.firstMatch.identifier == window.identifier { return true }
            app.typeKey("`", modifierFlags: .command)
            return false
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [front], timeout: 10), .completed, "\(window.identifier) did not come to the front")
    }

    /// Audits the front window alone: the main window brought forward with ⌘` and closed first (as `auditClubWindow`,
    /// whose Window-menu raise was seen to leave a player's window in front).
    @MainActor
    private func auditAlone(_ app: XCUIApplication, named name: String) throws {
        let main = app.windows.matching(NSPredicate(format: "identifier BEGINSWITH 'main'")).firstMatch
        if main.exists {
            bringForward(app, main)
            main.buttons[XCUIIdentifierCloseWindow].firstMatch.click()
            XCTAssertTrue(main.waitForNonExistence(timeout: 5), "the main window did not close")
        }
        try audit(app, named: name)
    }

    /// A player's window, by the identifier on its content.
    @MainActor
    private func playerWindow(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        element(app, "player.window.\(id)")
    }

    /// Every section of a player's window in turn: the tab chosen by its name, its page drawn.
    @MainActor
    private func everyTab(_ app: XCUIApplication, capture prefix: String? = nil) {
        for (tab, page) in [("Overview", "overview"), ("Ratings", "ratings"), ("Value", "value"), ("Contract & Rights", "contract"), ("History", "history"), ("Notes", "notes")] {
            // The section's segment in the player window's own control (never another window's "Ratings")
            let button = element(app, "player.sections").radioButtons.matching(NSPredicate(format: "label == %@ OR title == %@", tab, tab)).firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 10), "the player window has no \(tab) tab")
            button.click()
            // A segment clicked while the last section's table still held the keyboard can take a second click
            if !element(app, "player.tab.\(page)").waitForExistence(timeout: 4) { button.click() }
            XCTAssertTrue(element(app, "player.tab.\(page)").waitForExistence(timeout: 10), "the \(tab) tab did not draw")
            if let prefix { keep(app.windows.firstMatch.screenshot(), named: "\(prefix)-\(page)") }
        }
    }

    /// A player opens in his own window from anywhere (N11): the palette's served result, a table's row (a double-click),
    /// a name in a decision opened from the desk, and Following; opening him again brings his window forward rather than
    /// a second one. ⌘K in his window brings the main window forward with its palette (PR #58). Every section draws; the
    /// window is audited alone.
    @MainActor
    func testPlayerWindows() throws {
        let app = launch(arguments: ["-PennantDebugWindowSize", "1280x820"])
        waitForShell(app)
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(element(app, "morningReport.desk").waitForExistence(timeout: 30))
        // From the palette: the server's player result opens his window
        app.typeKey("k", modifierFlags: .command)
        let query = element(app, "palette.query")
        XCTAssertTrue(paletteOpened(app, query), "⌘K did not open the palette")
        query.click()
        query.typeText("p 1000")
        let result = element(app, "palette.result.search.player.1000")
        XCTAssertTrue(result.waitForExistence(timeout: 10), "the palette did not list the server's player")
        // The answer for the whole query in (the list is asked again as each letter is typed), then his result chosen
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !self.element(app, "palette.updating").exists }, object: nil)
        _ = XCTWaiter.wait(for: [settled], timeout: 5)
        // Return opens the result chosen, the first (his name, the query exactly)
        query.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(playerWindow(app, "1000").waitForExistence(timeout: 10), "the palette's player did not open his window")
        XCTAssertTrue(element(app, "player.header").waitForExistence(timeout: 30), "his dossier did not load")
        keep(app.windows.firstMatch.screenshot(), named: "n11-player-window-from-palette")
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(playerWindow(app, "1000").waitForNonExistence(timeout: 5), "⌘W did not close his window")
        // From a table: the rotation's first arm (every row there is a pitcher), double-clicked; again, and his one window
        // comes forward
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 30))
        element(app, "sidebar.majorLeague.pitchingStaff").click()
        let lineup = element(app, "table.pitching.0")
        XCTAssertTrue(lineup.waitForExistence(timeout: 20), "the rotation's table did not load")
        let row = firstRow(of: lineup)
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).doubleClick()
        let opened = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'player.window.'")).firstMatch
        XCTAssertTrue(opened.waitForExistence(timeout: 10), "a double-click on a row did not open his window")
        let id = String(opened.identifier.dropFirst("player.window.".count))
        XCTAssertTrue(element(app, "player.header").waitForExistence(timeout: 30))
        let main = app.windows.matching(NSPredicate(format: "identifier BEGINSWITH 'main'")).firstMatch
        bringForward(app, main)
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).doubleClick()
        let once = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "player.window.\(id)")).count == 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [once], timeout: 10), .completed, "opening him again made a second window")
        // Every section, and Follow (the sidebar's Following then names him)
        everyTab(app, capture: "n11-player")
        element(app, "player.follow").click()
        let followed = element(app, "following.player.\(id)")
        XCTAssertTrue(followed.waitForExistence(timeout: 10), "Follow in his window did not follow him")
        // From Following: his one window comes forward
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(playerWindow(app, id).waitForNonExistence(timeout: 5))
        followed.doubleClick()
        XCTAssertTrue(playerWindow(app, id).waitForExistence(timeout: 10), "Following did not open his window")
        app.typeKey("w", modifierFlags: .command)
        // From the desk: the need's decision, and a player it names
        bringForward(app, main)
        app.typeKey("2", modifierFlags: .command)
        let decision = element(app, "item.decision")
        XCTAssertTrue(decision.waitForExistence(timeout: 20), "the report's need offers no decision")
        decision.click()
        XCTAssertTrue(element(app, "decision.header").waitForExistence(timeout: 30), "the decision did not load")
        let named = element(app, "detail.majorLeague.decision").descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'player.' AND NOT (identifier BEGINSWITH 'player.window')")).firstMatch
        reveal(named, in: element(app, "detail.majorLeague.decision"))
        XCTAssertTrue(named.waitForExistence(timeout: 10), "the decision names no player")
        let namedId = String(named.identifier.dropFirst("player.".count))
        named.doubleClick()
        XCTAssertTrue(playerWindow(app, namedId).waitForExistence(timeout: 10), "a player named in the decision did not open his window")
        XCTAssertTrue(element(app, "player.header").waitForExistence(timeout: 30))
        keep(app.windows.firstMatch.screenshot(), named: "n11-player-window-from-decision")
        // ⌘K in his window (PR #58): the main window comes forward with its palette up; Escape puts it away
        app.typeKey("k", modifierFlags: .command)
        let palette = element(app, "palette.query")
        XCTAssertTrue(palette.waitForExistence(timeout: 5), "⌘K in his window did not open the palette")
        XCTAssertTrue(app.windows.firstMatch.identifier.hasPrefix("main"), "⌘K in his window left \(app.windows.firstMatch.identifier) in front")
        palette.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(element(app, "palette").waitForNonExistence(timeout: 5), "Escape did not put the palette away")
        // Audited alone (the main window closed, as a club's window is)
        try auditAlone(app, named: "accessibility-audit-n11-player-window")
        quitCleanly(app)
    }

    /// Compare (N11): two players chosen in a table compared from its context menu, a third dropped on the Compare window,
    /// one removed in a click. Audited alone.
    @MainActor
    func testCompareByMenuAndDrag() throws {
        // The Compare window against the screen's trailing edge, so its trailing side shows beside the main window
        let app = launch(arguments: ["-PennantDebugWindowSize", "900x700", "-PennantDebugCompareWindowSize", "560x600"])
        waitForShell(app)
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(element(app, "detail.majorLeague.report").waitForExistence(timeout: 30))
        element(app, "sidebar.majorLeague.pitchingStaff").click()
        let lineup = element(app, "table.pitching.0")
        XCTAssertTrue(lineup.waitForExistence(timeout: 20))
        XCTAssertTrue(firstRow(of: lineup).waitForExistence(timeout: 10))
        let rows = lineup.descendants(matching: .outlineRow).allElementsBoundByIndex + lineup.tableRows.allElementsBoundByIndex
        XCTAssertGreaterThanOrEqual(rows.count, 3, "the rotation lists fewer than three")
        let leading = { (row: XCUIElement) in row.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)) }
        leading(rows[0]).click()
        XCUIElement.perform(withKeyModifiers: .command) { leading(rows[1]).click() }
        leading(rows[1]).rightClick()
        let compare = contextMenuItem(app, "Compare")
        XCTAssertTrue(compare.waitForExistence(timeout: 5), "the rows' context menu has no Compare")
        compare.click()
        let window = element(app, "compare.window")
        XCTAssertTrue(window.waitForExistence(timeout: 10), "Compare did not open its window")
        let players = window.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'compare.player.'"))
        let two = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in players.count == 2 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [two], timeout: 10), .completed, "Compare did not take the two chosen players")
        XCTAssertTrue(element(app, "compare.table").waitForExistence(timeout: 30), "the comparison did not load")
        keep(app.windows.firstMatch.screenshot(), named: "n11-compare-two")
        // The main window in front, the Compare window's trailing side beside it: a third row dragged onto it
        let main = app.windows.matching(NSPredicate(format: "identifier BEGINSWITH 'main'")).firstMatch
        bringForward(app, main)
        let compareWindow = app.windows.containing(.any, identifier: "compare.window").firstMatch
        let drop = compareWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.6))
        leading(rows[2]).click(forDuration: 0.4, thenDragTo: drop, withVelocity: .slow, thenHoldForDuration: 0.8)
        let three = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in players.count == 3 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [three], timeout: 10), .completed, "the dropped player did not join the comparison")
        // Removing one is one click (the Compare window in front again)
        bringForward(app, compareWindow)
        let remove = window.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'compare.remove.'")).firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        remove.click()
        let twoAgain = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in players.count == 2 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [twoAgain], timeout: 10), .completed, "removing a player did not take him out")
        XCTAssertTrue(element(app, "compare.table").waitForExistence(timeout: 30))
        keep(app.windows.firstMatch.screenshot(), named: "n11-compare")
        try auditAlone(app, named: "accessibility-audit-n11-compare")
        quitCleanly(app)
    }

    /// A player's window comes back at the next launch, on his dossier (its value is his id).
    @MainActor
    func testPlayerWindowRestored() throws {
        let first = launch(arguments: ["-PennantDebugOpenPlayer", "1000"], restoresState: true)
        waitForShell(first)
        XCTAssertTrue(playerWindow(first, "1000").waitForExistence(timeout: 15), "the player's window did not open")
        XCTAssertTrue(element(first, "player.header").waitForExistence(timeout: 30))
        quitCleanly(first)
        let again = launch(restoresState: true)
        XCTAssertTrue(playerWindow(again, "1000").waitForExistence(timeout: 30), "his window was not restored at relaunch")
        XCTAssertTrue(element(again, "player.header").waitForExistence(timeout: 60), "the restored window did not load his dossier")
        keep(again.windows.firstMatch.screenshot(), named: "n11-player-window-restored")
        // Quit with the restored window still open; setUp and tearDown remove the saved windows, so the next test opens
        // without it. (Closing the restored window first and then quitting left the process unkillable on GitHub's
        // macOS 26 runner, a virtual machine: the app's log shows the quit answered, applicationWillTerminate reached
        // and the 5-second _exit net set, and the same pid alive 20 s later. A process _exit cannot end is held in the
        // kernel, not by the app. Closing a window and quitting is still exercised by testPlayerNoteKeptOnLeaving, and
        // the case is recorded in SWIFTUI_REBUILD "As built at N11".)
        quitCleanly(again)
    }

    /// The GM's note survives leaving it at once (review H2): typed, then another section chosen and the app quit at
    /// once; typed again, then the window closed and the app quit at once. Each time the next launch reads it back.
    @MainActor
    func testPlayerNoteKeptOnLeaving() throws {
        let notes = { (app: XCUIApplication) -> XCUIElement in
            let tab = self.element(app, "player.sections").radioButtons.matching(NSPredicate(format: "label == 'Notes' OR title == 'Notes'")).firstMatch
            XCTAssertTrue(tab.waitForExistence(timeout: 10))
            tab.click()
            // The editor is named so once his note is read
            let editor = self.element(app, "player.notes.editor")
            XCTAssertTrue(editor.waitForExistence(timeout: 20), "his note was not read")
            return editor
        }
        let open = { () -> XCUIApplication in
            let app = self.launch(arguments: ["-PennantDebugOpenPlayer", "1000"])
            self.waitForShell(app)
            XCTAssertTrue(self.playerWindow(app, "1000").waitForExistence(timeout: 15), "the player's window did not open")
            XCTAssertTrue(self.element(app, "player.header").waitForExistence(timeout: 30))
            return app
        }
        let reads = { (app: XCUIApplication, text: String) in
            let editor = notes(app)
            let kept = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (editor.value as? String) == text }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [kept], timeout: 10), .completed, "the note read back \(String(describing: editor.value)), not \(text)")
        }
        // Typed, then another section at once, then quit at once
        let first = open()
        let editor = notes(first)
        editor.click()
        editor.typeText("Kept on switching")
        element(first, "player.sections").radioButtons.matching(NSPredicate(format: "label == 'Overview' OR title == 'Overview'")).firstMatch.click()
        quitCleanly(first)
        let second = open()
        reads(second, "Kept on switching")
        // Typed again, then the window closed by its own button at once, then quit at once
        let again = notes(second)
        again.click()
        again.typeKey("a", modifierFlags: .command)
        again.typeText("Kept on closing")
        second.windows.containing(.any, identifier: "player.window.1000").firstMatch.buttons[XCUIIdentifierCloseWindow].click()
        quitCleanly(second)
        let third = open()
        reads(third, "Kept on closing")
        third.windows.containing(.any, identifier: "player.window.1000").firstMatch.buttons[XCUIIdentifierCloseWindow].click()
        quitCleanly(third)
    }

    /// A small player window (520 × 480): every section, five rounds, nothing cut off and the app up throughout (the N8
    /// crash was a constraint loop on a narrow window); audited.
    @MainActor
    func testPlayerNarrowWindow() throws {
        let app = launch(arguments: ["-PennantDebugOpenPlayer", "1000", "-PennantDebugPlayerWindowSize", "520x480"])
        waitForShell(app)
        let window = playerWindow(app, "1000")
        XCTAssertTrue(window.waitForExistence(timeout: 15), "the player's window did not open")
        XCTAssertTrue(element(app, "player.header").waitForExistence(timeout: 30))
        let narrow = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.windows.containing(.any, identifier: "player.window.1000").firstMatch.frame.width <= 525
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [narrow], timeout: 10), .completed, "the player's window did not take the small size")
        for round in 1...5 {
            everyTab(app, capture: round == 1 ? "n11-player-narrow" : nil)
            XCTAssertEqual(app.state, .runningForeground, "the app stopped in round \(round)")
        }
        // The header's name and the tabs are inside the window, not cut by its edge
        let frame = app.windows.containing(.any, identifier: "player.window.1000").firstMatch.frame
        XCTAssertTrue(frame.insetBy(dx: -1, dy: -1).contains(element(app, "player.name").frame), "his name runs past the window")
        try auditAlone(app, named: "accessibility-audit-n11-player-narrow")
        quitCleanly(app)
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
        // The picture must be the whole window at one scale: a window running past its screen's edge is pictured only in
        // the part on the screen, and a scale taken from its width would read every element's pixels from the wrong place
        // (PR #54: a 1280-point window on the runner's 1024-point screen read black text at 1.0:1). No pixels, then, and
        // nothing is set aside by them
        let across = CGFloat(w) / frame.width, down = CGFloat(h) / frame.height
        guard abs(across - down) < 0.05 else { return nil }
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

/// The visible rectangle of a native table's own scroll area, measured from the accessibility tree, and whether an
/// element of that table is clipped by it (see `audit`). A native `Table` clips its rows and columns to its own scroll
/// view, as Finder's list view does, and VoiceOver scrolls to them; the audit still measures a row or a column past
/// that edge, whose pixels on the screen are not its own.
nonisolated struct ScrollClip: Equatable {
    /// What of the scroll area shows: its frame, inside its window, less the strips its scroll bars draw over.
    let visible: CGRect

    /// An element of a table's tree as the audit names one: its type and its frame, to whole points.
    struct Member: Hashable {
        let type: UInt
        let x, y, w, h: Int

        init(_ type: XCUIElement.ElementType, _ frame: CGRect) {
            self.type = type.rawValue
            x = Int(frame.minX.rounded()); y = Int(frame.minY.rounded()); w = Int(frame.width.rounded()); h = Int(frame.height.rounded())
        }
    }

    /// - Parameters:
    ///   - scrollArea: the frame of the table's enclosing scroll view as the accessibility tree reports it (or the
    ///     table's own frame, when the tree has no scroll view around it).
    ///   - window: the frame of the window that holds it.
    ///   - scrollBars: the frames of that scroll view's own scroll bars in the tree (none while they are hidden).
    init(scrollArea: CGRect, window: CGRect, scrollBars: [CGRect] = []) {
        var visible = scrollArea.intersection(window)
        for bar in scrollBars where visible.intersects(bar) {
            if bar.width > bar.height, bar.minY > visible.midY {
                visible.size.height = max(0, bar.minY - visible.minY)
            } else if bar.height > bar.width, bar.minX > visible.midX {
                visible.size.width = max(0, bar.minX - visible.minX)
            }
        }
        self.visible = visible.isNull ? .zero : visible
    }

    /// Whether an element's frame lies wholly or partly outside the visible rectangle. One wholly inside is never
    /// clipped, whatever the audit says of it.
    func clips(_ frame: CGRect) -> Bool {
        !visible.contains(frame)
    }
}

/// The scroll-area rule on its own: it excuses only what lies outside the visible rectangle (no app needed).
final class ScrollClipTests: XCTestCase {
    private let window = CGRect(x: 0, y: 23, width: 1024, height: 677)
    private let table = CGRect(x: 290, y: 194, width: 734, height: 240)

    func testAVisibleCellIsNeverExcused() {
        let clip = ScrollClip(scrollArea: table, window: window)
        XCTAssertFalse(clip.clips(CGRect(x: 304, y: 234, width: 46, height: 16)), "a cell wholly in the table's visible rectangle was excused")
        XCTAssertFalse(clip.clips(table), "the visible rectangle itself was excused")
    }

    func testAClippedCellIsExcused() {
        let clip = ScrollClip(scrollArea: table, window: window)
        // A row past the table's bottom edge (under the detail pane), and a column past its trailing edge
        XCTAssertTrue(clip.clips(CGRect(x: 304, y: 444, width: 104, height: 16)))
        XCTAssertTrue(clip.clips(CGRect(x: 976, y: 230, width: 64, height: 24)), "a column cut by the table's edge")
        XCTAssertTrue(clip.clips(CGRect(x: 1100, y: 230, width: 64, height: 24)), "a column wholly past it")
    }

    func testScrollBarsAndTheWindowNarrowTheVisibleRectangle() {
        let bars = [CGRect(x: 290, y: 420, width: 720, height: 14), CGRect(x: 1010, y: 194, width: 14, height: 226)]
        // A scroll area wider than its window: the window's edge bounds it too
        let clip = ScrollClip(scrollArea: CGRect(x: 290, y: 194, width: 900, height: 240), window: window, scrollBars: bars)
        XCTAssertEqual(clip.visible, CGRect(x: 290, y: 194, width: 720, height: 226))
        XCTAssertTrue(clip.clips(CGRect(x: 814, y: 418.5, width: 17, height: 16)), "a cell under the horizontal scroll bar")
        XCTAssertFalse(clip.clips(CGRect(x: 814, y: 391.5, width: 17, height: 16)), "a cell above the scroll bar")
    }
}
