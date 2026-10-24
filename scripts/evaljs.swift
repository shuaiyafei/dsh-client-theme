import Cocoa
import WebKit

let args = CommandLine.arguments

func fail(_ message: String, _ code: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

guard (3...6).contains(args.count) else {
    fail("Usage: evaljs URL SCRIPT_OR_@FILE [WAIT_SECONDS WIDTH HEIGHT]")
}
guard let url = URL(string: args[1]),
      ["http", "https"].contains(url.scheme ?? ""), url.host != nil else {
    fail("URL must be an absolute HTTP or HTTPS URL")
}
var script = args[2]
if script.hasPrefix("@") {
    do {
        script = try String(contentsOfFile: String(script.dropFirst()), encoding: .utf8)
    } catch {
        fail("Cannot read script: \(error.localizedDescription)")
    }
}
func number(_ index: Int, _ fallback: Double, _ name: String, zero: Bool = false) -> Double {
    guard args.count > index else { return fallback }
    guard let value = Double(args[index]), value.isFinite,
          (zero ? value >= 0 : value > 0) else {
        fail("\(name) must be a finite \(zero ? "non-negative" : "positive") number")
    }
    return value
}
let wait = number(3, 6, "Wait", zero: true)
let w = number(4, 1440, "Width")
let h = number(5, 900, "Height")

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
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: config)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h), styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = webView
window.orderBack(nil)
let d = Delegate()
webView.navigationDelegate = d

d.onReady = {
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
        webView.evaluateJavaScript(script) { result, error in
            if let error = error { fail("JavaScript failed: \(error.localizedDescription)") }
            if let s = result as? String { print(s) }
            else if let r = result { print(String(describing: r)) }
            exit(0)
        }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + wait + 60) {
    fail("Timed out waiting for navigation or JavaScript", 5)
}
webView.load(URLRequest(url: url))
RunLoop.main.run()
