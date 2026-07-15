// ccost.app — нативная macOS-обёртка дашборда: запускает встроенный движок
// «ccost gui --no-open» (бинарь в Resources бандла), ловит URL из stdout
// и показывает дашборд в WKWebView на всю высоту окна (шапка = тайтлбар).
// Сборка: sh build.sh (движок задаётся через CCOST_ENGINE)
import Cocoa
import WebKit

let BG = NSColor(srgbRed: 0.043, green: 0.055, blue: 0.071, alpha: 1.0)   // #0b0e12

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    var proc: Process?
    var statusItem: NSStatusItem?
    var serverURL: String?
    var menubarOn = true
    var statusTimer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        let rect = NSRect(x: 0, y: 0, width: 1240, height: 860)
        // контент на всю высоту: шапка дашборда и есть тайтлбар (монолит),
        // светофоры ложатся поверх, перетаскивание — через JS-мост «drag»
        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable,
                                      .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "ccost"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        // пустой unified-тулбар делает тайтлбар выше — светофоры опускаются
        // на линию шапки дашборда
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
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

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
        </style><body><i></i> ccost · читаю сессии…</body>
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
            showError("в бандле нет ccost"); return
        }
        // Resources/ccost — полноценный бинарь (PyInstaller); в dev-сборке
        // может лежать скрипт — shebang подхватит python3 сам
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
                self?.showError("встроенный сервер ccost завершился — нужен python3 в PATH")
            }
        }
        do { try p.run() } catch {
            showError("не запустился python3: \(error.localizedDescription)")
        }
        proc = p
    }

    @objc func reload(_ sender: Any?) { webView.reload() }

    // ---------------------------------------------------------- menu bar
    // Живой «$сегодня» в статус-баре; включается тумблером в настройках
    // дашборда (config.menubar), опрашивается вместе со стоимостью.
    func startStatusUpdates() {
        refreshStatus()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) {
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
        fetchJSON("config") { [weak self] cfg in
            guard let self = self else { return }
            let conf = cfg["config"] as? [String: Any]
            self.menubarOn = (conf?["menubar"] as? Bool) ?? true
            if !self.menubarOn {
                if let item = self.statusItem {
                    NSStatusBar.system.removeStatusItem(item)
                    self.statusItem = nil
                }
                return
            }
            self.ensureStatusItem()
            self.fetchJSON("data?period=1") { d in
                guard let total = d["total"] as? [String: Any],
                      let cost = total["cost"] as? Double else {
                    self.statusItem?.button?.title = "$0"
                    return
                }
                self.statusItem?.button?.title =
                    cost >= 100 ? String(format: "$%.0f", cost)
                                : String(format: "$%.2f", cost)
            }
        }
    }

    func ensureStatusItem() {
        if statusItem != nil { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
        item.button?.title = "…"
        let menu = NSMenu()
        let open = NSMenuItem(title: "Открыть ccost",
                              action: #selector(openWindow(_:)), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Выйти",
                                action: #selector(NSApplication.terminate(_:)),
                                keyEquivalent: "q"))
        item.menu = menu
        statusItem = item
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

    // при включённом menu bar закрытие окна не убивает приложение —
    // счётчик продолжает жить в статус-баре
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
        return statusItem == nil
    }

    func applicationWillTerminate(_ note: Notification) {
        proc?.terminationHandler = nil
        proc?.terminate()
    }
}

// минимальное меню: Cmd+Q, Cmd+W, Cmd+R и Edit для копирования из дашборда
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
