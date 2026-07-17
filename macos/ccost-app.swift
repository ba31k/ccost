// ccost.app — native macOS shell for the dashboard: launches the bundled
// engine ("ccost gui --no-open" binary in Resources), reads the URL from its
// stdout and shows the dashboard in a full-height WKWebView (header acts as
// the titlebar). Build: sh build.sh (engine path via CCOST_ENGINE)
import Cocoa
import ServiceManagement
import WebKit

let BG = NSColor(srgbRed: 0.043, green: 0.055, blue: 0.071, alpha: 1.0)   // #0b0e12
let METRICS: [(key: String, label: String)] = [
    ("today", "$ today"), ("hour", "$ / hour"), ("month", "$ month"),
    ("msgs", "messages"), ("tok", "tokens"),
]

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    var proc: Process?
    var statusItem: NSStatusItem?
    var serverURL: String?
    var menubarOn = true
    var statusTimer: Timer?
    var metricItems: [String: NSMenuItem] = [:]
    var loginItem: NSMenuItem?
    var metricsSel: [String] = ["today"]

    func applicationDidFinishLaunching(_ note: Notification) {
        let rect = NSRect(x: 0, y: 0, width: 1240, height: 860)
        // full-height content: the dashboard header is the titlebar; traffic
        // lights overlay it, dragging goes through the JS "drag" bridge
        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable,
                                      .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "ccost"
        // programmatic NSWindows release themselves on close; the menu bar
        // counter reopens this window later, so keep it alive
        window.isReleasedWhenClosed = false
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        // an empty unified toolbar makes the titlebar taller — traffic lights
        // drop onto the dashboard header line
        window.toolbarStyle = .unified
        let tb = NSToolbar(identifier: "ccost-tb")
        tb.showsBaselineSeparator = false
        window.toolbar = tb
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = BG
        window.minSize = NSSize(width: 720, height: 480)
        window.setFrameAutosaveName("ccost-main")
        window.center()

        let conf = WKWebViewConfiguration()
        conf.userContentController.add(self, name: "ccost")
        webView = WKWebView(frame: rect, configuration: conf)
        webView.autoresizingMask = [.width, .height]
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = BG }
        window.contentView = webView
        // launched as a login item ('lgit' in the open event): stay in the
        // menu bar only, the window is a click away
        let ev = NSAppleEventManager.shared().currentAppleEvent
        let atLogin = ev?.paramDescriptor(forKeyword: AEKeyword(0x7072_6474))?
            .enumCodeValue == 0x6C67_6974
        if !atLogin {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }

        showSplash()
        launchServer()
    }

    func userContentController(_ ucc: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "ccost", let cmd = message.body as? String else { return }
        switch cmd {
        case "drag":
            if let ev = NSApp.currentEvent { window.performDrag(with: ev) }
        case "zoom":
            window.performZoom(nil)
        default:
            break
        }
    }

    func showSplash() {
        webView.loadHTMLString("""
        <!doctype html><meta charset="utf-8"><style>
        body{background:#0b0e12;color:#77828f;font:14px ui-monospace,Menlo,monospace;
             display:flex;align-items:center;justify-content:center;height:96vh}
        i{width:9px;height:9px;border-radius:50%;background:#7ee787;margin-right:10px;
          box-shadow:0 0 10px rgba(126,231,135,.7);animation:p 1.2s infinite}
        @keyframes p{50%{opacity:.25}}
        </style><body><i></i> ccost · reading sessions…</body>
        """, baseURL: nil)
    }

    func showError(_ msg: String) {
        webView.loadHTMLString("""
        <!doctype html><meta charset="utf-8"><style>
        body{background:#0b0e12;color:#e0b072;font:14px ui-monospace,Menlo,monospace;
             display:flex;align-items:center;justify-content:center;height:96vh}
        </style><body>\(msg)</body>
        """, baseURL: nil)
    }

    func launchServer() {
        guard let script = Bundle.main.path(forResource: "ccost", ofType: nil) else {
            showError("ccost engine missing from the bundle"); return
        }
        // Resources/ccost is a standalone binary (PyInstaller); a dev build
        // may contain the script instead — the shebang picks up python3
        let p = Process()
        p.executableURL = URL(fileURLWithPath: script)
        p.arguments = ["gui", "--no-open"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        var buf = ""
        pipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            guard let s = String(data: h.availableData, encoding: .utf8), !s.isEmpty else { return }
            buf += s
            if let r = buf.range(of: "http://127\\.0\\.0\\.1:[0-9]+/",
                                 options: .regularExpression) {
                let url = String(buf[r])
                pipe.fileHandleForReading.readabilityHandler = nil
                DispatchQueue.main.async {
                    self?.serverURL = url
                    self?.webView.load(URLRequest(url: URL(string: url)!))
                    self?.startStatusUpdates()
                }
            }
        }
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.showError("the embedded ccost server exited — python3 required in PATH")
            }
        }
        do { try p.run() } catch {
            showError("failed to launch: \(error.localizedDescription)")
        }
        proc = p
    }

    @objc func reload(_ sender: Any?) { webView.reload() }

    // ---------------------------------------------------------- menu bar
    // Live "$ today" in the status bar; toggled from the dashboard settings
    // (config.menubar), polled together with the cost.
    func startStatusUpdates() {
        refreshStatus()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) {
            [weak self] _ in self?.refreshStatus()
        }
    }

    func fetchJSON(_ path: String, done: @escaping ([String: Any]) -> Void) {
        guard let base = serverURL, let u = URL(string: base + path) else { return }
        URLSession.shared.dataTask(with: u) { data, _, _ in
            guard let d = data,
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
            else { return }
            DispatchQueue.main.async { done(obj) }
        }.resume()
    }

    func refreshStatus() {
        // the engine picks the metrics (config.menubar_metrics) and formats
        // the title; this side only displays it
        fetchJSON("statusbar") { [weak self] st in
            guard let self = self else { return }
            self.menubarOn = (st["enabled"] as? Bool) ?? true
            if !self.menubarOn {
                if let item = self.statusItem {
                    NSStatusBar.system.removeStatusItem(item)
                    self.statusItem = nil
                }
                return
            }
            self.ensureStatusItem()
            self.statusItem?.button?.title = (st["title"] as? String) ?? "…"
            self.metricsSel = (st["metrics"] as? [String]) ?? self.metricsSel
            self.updateMenuState()
        }
    }

    func postConfig(_ body: [String: Any]) {
        guard let base = serverURL, let u = URL(string: base + "config"),
              let data = try? JSONSerialization.data(withJSONObject: body)
        else { return }
        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.httpBody = data
        URLSession.shared.dataTask(with: req) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.refreshStatus() }
        }.resume()
    }

    func ensureStatusItem() {
        if statusItem != nil { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
        item.button?.title = "…"
        let menu = NSMenu()
        menu.autoenablesItems = false
        let open = NSMenuItem(title: "Open ccost",
                              action: #selector(openWindow(_:)), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        menu.addItem(NSMenuItem.separator())
        let header = NSMenuItem(title: "Show in the bar", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        for m in METRICS {
            let mi = NSMenuItem(title: m.label,
                                action: #selector(toggleMetric(_:)), keyEquivalent: "")
            mi.target = self
            mi.representedObject = m.key
            mi.indentationLevel = 1
            menu.addItem(mi)
            metricItems[m.key] = mi
        }
        menu.addItem(NSMenuItem.separator())
        let login = NSMenuItem(title: "Launch at login",
                               action: #selector(toggleLogin(_:)), keyEquivalent: "")
        login.target = self
        menu.addItem(login)
        loginItem = login
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit",
                                action: #selector(NSApplication.terminate(_:)),
                                keyEquivalent: "q"))
        item.menu = menu
        statusItem = item
        updateMenuState()
    }

    func updateMenuState() {
        for (key, mi) in metricItems {
            mi.state = metricsSel.contains(key) ? .on : .off
        }
        if #available(macOS 13.0, *) {
            loginItem?.state = SMAppService.mainApp.status == .enabled ? .on : .off
        } else {
            loginItem?.isHidden = true
        }
    }

    @objc func toggleMetric(_ sender: NSMenuItem) {
        guard let key = sender.representedObject as? String else { return }
        var sel = metricsSel
        if let i = sel.firstIndex(of: key) {
            sel.remove(at: i)
        } else {
            sel.append(key)
        }
        metricsSel = sel
        updateMenuState()               // instant checkmark, server confirms after
        postConfig(["menubar_metrics": sel])
    }

    @objc func toggleLogin(_ sender: NSMenuItem) {
        guard #available(macOS 13.0, *) else { return }
        let svc = SMAppService.mainApp
        do {
            if svc.status == .enabled {
                try svc.unregister()
            } else {
                try svc.register()
            }
        } catch {
            NSLog("login item: \(error.localizedDescription)")
        }
        updateMenuState()
    }

    @objc func openWindow(_ sender: Any?) {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ app: NSApplication,
                                       hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    // with the menu bar counter on, closing the window keeps the app alive
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
        return statusItem == nil
    }

    func applicationWillTerminate(_ note: Notification) {
        proc?.terminationHandler = nil
        proc?.terminate()
    }
}

// minimal menu: Cmd+Q, Cmd+W, Cmd+R plus Edit for copying from the dashboard
func buildMenu(_ d: AppDelegate) -> NSMenu {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(NSMenuItem(title: "Quit ccost",
                               action: #selector(NSApplication.terminate(_:)),
                               keyEquivalent: "q"))
    appItem.submenu = appMenu

    let viewItem = NSMenuItem(); main.addItem(viewItem)
    let view = NSMenu(title: "View")
    let reload = NSMenuItem(title: "Reload", action: #selector(AppDelegate.reload(_:)),
                            keyEquivalent: "r")
    reload.target = d
    view.addItem(reload)
    view.addItem(NSMenuItem(title: "Close Window",
                            action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
    viewItem.submenu = view

    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    edit.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
    edit.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)),
                            keyEquivalent: "a"))
    editItem.submenu = edit
    return main
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.mainMenu = buildMenu(delegate)
app.run()
