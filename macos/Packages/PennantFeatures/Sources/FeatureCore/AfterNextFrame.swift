import CoreFoundation
import Foundation

/// Runs a closure once the run loop has finished its current pass, after Core Animation has committed the frame the
/// pass laid out (an observer before the loop waits, ordered after Core Animation's commit): when a view's first frame
/// is on the screen, as near as the app can tell.
@MainActor
public enum AfterNextFrame {
    public static func run(_ body: @escaping @MainActor () -> Void) {
        let observer = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.beforeWaiting.rawValue, false, CFIndex.max) { observer, _ in
            if let observer { CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, .commonModes) }
            MainActor.assumeIsolated { body() }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
    }
}
