import Cocoa
import WebKit

let args = CommandLine.arguments

func fail(_ message: String, _ code: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

guard (3...7).contains(args.count) else {
    fail("Usage: shot URL OUTPUT.png [WIDTH HEIGHT WAIT_SECONDS [PRE_SCRIPT.js]]")
}
guard let url = URL(string: args[1]),
      ["http", "https"].contains(url.scheme ?? ""), url.host != nil else {
    fail("URL must be an absolute HTTP or HTTPS URL")
}

func number(_ index: Int, _ fallback: Double, _ name: String, zero: Bool = false) -> Double {
    guard args.count > index else { return fallback }
    guard let value = Double(args[index]), value.isFinite,
          (zero ? value >= 0 : value > 0) else {
        fail("\(name) must be a finite \(zero ? "non-negative" : "positive") number")
    }
    return value
}

let outPath = args[2]
let width = number(3, 1440, "Width")
let height = number(4, 900, "Height")
let wait = number(5, 7, "Wait", zero: true)
var preScript: String?
if args.count > 6 {
    do {
        preScript = try String(contentsOfFile: args[6], encoding: .utf8)
    } catch {
        fail("Cannot read pre-script: \(error.localizedDescription)")
    }
}

final class Delegate: NSObject, WKNavigationDelegate {
    var onReady: (() -> Void)?
    private var scheduled = false

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("Navigation failed: \(error.localizedDescription)")
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("Navigation failed: \(error.localizedDescription)")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame,
           let response = navigationResponse.response as? HTTPURLResponse,
           response.statusCode >= 400 {
            decisionHandler(.cancel)
            fail("Main document returned HTTP \(response.statusCode)")
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !scheduled else { return }
        scheduled = true
        onReady?()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                      styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = webView
window.orderBack(nil)

let delegate = Delegate()
webView.navigationDelegate = delegate

@MainActor
func snapshot() {
    let snapConfig = WKSnapshotConfiguration()
    snapConfig.rect = NSRect(x: 0, y: 0, width: width, height: height)
    webView.takeSnapshot(with: snapConfig) { image, error in
        if let error = error {
            fail("Snapshot failed: \(error.localizedDescription)")
        }
        guard let image = image, let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            fail("Snapshot returned no PNG image", 3)
        }
        do {
            let output = URL(fileURLWithPath: outPath)
            try FileManager.default.createDirectory(at: output.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try png.write(to: output, options: .atomic)
        } catch {
            fail("PNG write failed: \(error.localizedDescription)", 4)
        }
        print("saved \(outPath) \(rep.pixelsWide)x\(rep.pixelsHigh)")
        exit(0)
    }
}

delegate.onReady = {
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
        if let js = preScript {
            webView.evaluateJavaScript(js) { _, error in
                if let error = error { fail("Pre-script failed: \(error.localizedDescription)") }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { snapshot() }
            }
        } else {
            snapshot()
        }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + wait + 60) {
    fail("Timed out waiting for navigation or snapshot", 5)
}
webView.load(URLRequest(url: url))
RunLoop.main.run()
