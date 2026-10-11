import Foundation
import PennantAPI
import PennantGlance
import PennantKit
import WidgetKit

/// Pennant outside its windows, kept current (N14, Stage A, D-075): after each refresh (a new import, club, restore or
/// build) and each desk change, the served glance is read and written to the App Group for the widget, and the served
/// list is handed to Spotlight. The menu bar extra draws the same glance from the model. Nothing is read while the club
/// question is open (the Dock badge shows nothing then either), and nothing here decides what matters.
@MainActor
final class Integration {
    private let model: AppModel
    private let glanceStore: GlanceSnapshotStore
    private let spotlight: SpotlightIndexer?
    private let log: (String) -> Void
    private var loading: Task<Void, Never>?

    init(model: AppModel, glanceStore: GlanceSnapshotStore, spotlight: SpotlightIndexer?) {
        self.model = model
        self.glanceStore = glanceStore
        self.spotlight = spotlight
        let serverLog = model.serverController.log
        log = { serverLog.write($0, source: "app") }
    }

    func start() {
        let store = model.integration
        let glanceStore = glanceStore
        let log = log
        store.onSnapshot = { snapshot in
            do {
                if try glanceStore.write(snapshot) {
                    WidgetCenter.shared.reloadTimelines(ofKind: GlanceTimeline.widgetKind)
                    log("glance: wrote the widget's snapshot (\(snapshot.desk.count) on the desk)")
                }
            } catch {
                log("glance: could not write the widget's snapshot: \((error as NSError).domain) \((error as NSError).code)")
            }
        }
        store.onSpotlight = { [spotlight] list in spotlight?.index(list) }
        log(glanceStore.folder == nil
            ? "glance: no App Group container this build can reach (unsigned, or not entitled): the widget gets no snapshot"
            : "glance: the widget's snapshot is kept in the App Group")
        if spotlight == nil { log("spotlight: this development build does not index (-PennantDevSpotlight YES to)") }
        follow()
    }

    /// What a refresh reads on: the store key, the desk's stamp, the club question, and the club's served colours.
    private struct Trigger: Equatable {
        var key: AppModel.StoreKey?
        var deskStamp: String?
        var owed: Bool
        var colors: GlanceSnapshot.Colors?
    }

    private var trigger: Trigger {
        Trigger(
            key: model.storeKey,
            deskStamp: model.frontOffice.summary?.deskStamp,
            owed: model.clubOwed != nil,
            colors: IntegrationStore.colors(of: model.catalogClub?.theme, useTeamColors: model.settings?.settings.useTeamColors ?? true)
        )
    }

    private var last: Trigger?

    private func follow() {
        let now = withObservationTracking { trigger } onChange: { [weak self] in
            Task { @MainActor in self?.follow() }
        }
        guard now != last else { return }
        let before = last
        last = now
        guard !now.owed, now.key != nil else { return }
        // Only the club's colours changed (team colours turned off, another theme): the same glance, written again
        if let before, before.key == now.key, before.deskStamp == now.deskStamp, before.owed == now.owed,
           let glance = model.integration.glance {
            model.integration.onSnapshot?(IntegrationStore.snapshot(of: glance, colors: now.colors, at: Date()))
            return
        }
        // A load already under way for an earlier key finishes on its own: the store keeps only the answer for the key
        // it last asked about
        let model = model
        loading = Task {
            await model.integration.load(client: model.client, key: now.key, deskStamp: now.deskStamp, colors: now.colors)
        }
    }
}
