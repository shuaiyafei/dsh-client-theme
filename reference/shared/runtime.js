/** Shared browser runtime. scripts/build-themes.mjs embeds it in each package. */
export function createThemePlugin(config, palette, skinCss, bootTemplate) {
	const noop = () => {};
	const darkTokens = Object.fromEntries(
		Object.entries(palette).map(([name, dark]) => [name, { light: dark, dark }])
	);
	const escapeText = (value) => String(value).replace(/[&<>"']/g, (character) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
	})[character]);
	const render = (template) => template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
		if (!Object.hasOwn(config, name)) throw new Error(`Unknown theme field: ${name}`);
		return escapeText(config[name]);
	});
	const bootKey = `dsh-client-theme:boot:${config.id}:v3`;
	const pageBootsKey = Symbol.for("dsh-client-theme.played-boots");

	function playedBoot() {
		return window[pageBootsKey]?.has(bootKey) ?? false;
	}

	function rememberBoot() {
		// A fresh document replays the intro. Only plugin remounts are deduplicated.
		// WKWebView can preserve sessionStorage across desktop app restarts.
		window[pageBootsKey] ??= new Set();
		window[pageBootsKey].add(bootKey);
	}

	function mountBoot(force = false) {
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return noop;
		if (!force && config.bootOnce !== false && playedBoot()) return noop;

		const overlay = document.createElement("div");
		overlay.className = "u02-boot";
		overlay.dataset.theme = config.id;
		overlay.style.setProperty("--dsh-boot-ratio", String((config.bootScale ?? 2) / 2));
		overlay.setAttribute("aria-hidden", "true");
		overlay.innerHTML = render(bootTemplate);
		document.body.append(overlay);
		rememberBoot();

		const mode = overlay.querySelector(".u02-boot-mode");
		const sweep = overlay.querySelector(".u02-boot-sweep");
		const beam = overlay.querySelector(".u02-beam");
		const ring = overlay.querySelector(".u02-ring-fill");
		const ringNum = overlay.querySelector(".u02-ring-num");
		const barFill = overlay.querySelector(".u02-bar-fill");
		const barPct = overlay.querySelector(".u02-pct");
		const access = overlay.querySelector(".u02-access");
		const timers = new Set();
		const frames = new Set();
		const scale = config.bootScale ?? 2;
		const beat = (milliseconds) => milliseconds * scale;
		let finished = false;
		let activeScan = null;

		const after = (milliseconds, callback) => {
			const timer = window.setTimeout(() => {
				timers.delete(timer);
				callback();
			}, milliseconds);
			timers.add(timer);
		};
		const clearFrames = () => {
			for (const frame of frames) window.cancelAnimationFrame(frame);
			frames.clear();
		};
		const stop = () => {
			for (const timer of timers) window.clearTimeout(timer);
			timers.clear();
			clearFrames();
			activeScan?.cancel();
			activeScan = null;
		};
		const removeListeners = () => {
			overlay.removeEventListener("pointerdown", skip);
			document.removeEventListener("keydown", skip, true);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
		const finish = () => {
			if (finished) return;
			finished = true;
			stop();
			removeListeners();
			overlay.classList.add("u02-boot-out");
			after(360 * scale / 2, () => overlay.remove());
		};
		const skip = (event) => {
			if (event.type === "keydown" && !event.isComposing && ["Enter", " ", "Escape"].includes(event.key)) {
				event.preventDefault();
				event.stopPropagation();
			}
			finish();
		};
		const requestFrame = (callback) => {
			const frame = window.requestAnimationFrame((now) => {
				frames.delete(frame);
				if (!finished) callback(now);
			});
			frames.add(frame);
		};
		const stages = [
			{ id: "lcl", mode: "LCL INJECTION", duration: 780 },
			{ id: "neural", mode: "NEURAL LINK", duration: 840 },
			{ id: "verify", mode: "VERIFYING PILOT IDENTITY", duration: 1060 },
			{ id: "access", mode: "ACCESS PERMISSION", duration: 580 },
			{ id: "startup", mode: `UNIT-${config.unit} ACTIVATION`, duration: 860 }
		];
		const onVisibilityChange = () => {
			if (finished || !activeScan || activeScan.playState === "finished") return;
			if (document.hidden) activeScan.pause();
			else activeScan.play();
		};
		const updateStage = (stage, progress) => {
			const eased = 1 - Math.pow(1 - progress, 3);
			const value = (config.syncTarget * eased).toFixed(1);
			if (stage.id === "neural") {
				ring?.style.setProperty("--p", eased.toFixed(4));
				if (ringNum) ringNum.textContent = value;
			} else if (stage.id === "verify") {
				if (barFill) barFill.style.transform = `scaleX(${eased.toFixed(4)})`;
				if (barPct) barPct.textContent = value;
			} else if (stage.id === "access" && progress >= 0.5) {
				access?.classList.add("is-cleared");
			}
		};
		const playStage = async (stage) => {
			if (finished) return false;
			clearFrames();
			activeScan?.cancel();
			for (const node of overlay.querySelectorAll(".u02-stage")) {
				node.classList.toggle("is-in", node.dataset.stage === stage.id);
			}
			overlay.dataset.stage = stage.id;
			if (mode) mode.textContent = stage.mode;

			const isLcl = stage.id === "lcl";
			sweep.hidden = isLcl;
			const element = isLcl ? beam : sweep;
			const keyframes = isLcl
				? [{ transform: "translateY(100%)" }, { transform: "translateY(0%)" }]
				: [
					{ transform: "translateY(calc(100vh + 140px))" },
					{ transform: "translateY(-140px)" }
				];
			const duration = beat(stage.duration);
			const scan = element.animate(keyframes, {
				duration, easing: "linear", fill: "both"
			});
			activeScan = scan;
			onVisibilityChange();
			const tick = () => {
				if (finished || activeScan !== scan) return;
				const elapsed = typeof scan.currentTime === "number" ? scan.currentTime : 0;
				updateStage(stage, Math.max(0, Math.min(1, elapsed / duration)));
				requestFrame(tick);
			};
			requestFrame(tick);
			try {
				// The next scene waits for the visible light edge to reach the top.
				await scan.finished;
			} catch (error) {
				if (finished || error.name === "AbortError") return false;
				throw error;
			}
			if (finished) return false;
			clearFrames();
			updateStage(stage, 1);
			return true;
		};
		const playSequence = async () => {
			for (const stage of stages) {
				if (!await playStage(stage)) return;
			}
			finish();
		};
		overlay.addEventListener("pointerdown", skip);
		document.addEventListener("keydown", skip, true);
		document.addEventListener("visibilitychange", onVisibilityChange);
		void playSequence().catch((error) => {
			if (finished) return;
			console.warn(`[${config.id}] Boot animation stopped`, error);
			finish();
		});

		return () => {
			finished = true;
			stop();
			removeListeners();
			overlay.remove();
		};
	}

	function mountSkin() {
		const style = document.createElement("style");
		style.dataset.plugin = config.id;
		style.dataset.pluginCss = `${config.id}/skin.css`;
		style.textContent = skinCss;
		document.head.append(style);

		const gauge = document.createElement("div");
		gauge.className = "u02-gauge";
		gauge.setAttribute("aria-hidden", "true");
		gauge.innerHTML =
			'<div class="u02-gauge-ring"></div>' +
			'<div class="u02-gauge-core"><span class="u02-gauge-value">' +
			escapeText(config.syncTarget.toFixed(1)) +
			'</span><span class="u02-gauge-unit">%</span></div>' +
			'<div class="u02-gauge-label">SYNC RATIO</div>';
		document.body.append(gauge);

		const marks = new Map();
		const observed = new Set();
		let disposed = false;
		let pending = 0;
		let forceMeasure = false;
		let previousMain = null;
		let previousSidebar = null;
		const mark = (attribute, element) => {
			const previous = marks.get(attribute);
			if (previous?.element === element) return;
			if (previous?.owned) previous.element.removeAttribute(attribute);
			marks.delete(attribute);
			if (!element) return;
			const owned = !element.hasAttribute(attribute);
			if (owned) element.setAttribute(attribute, "");
			marks.set(attribute, { element, owned });
		};
		const hasBox = (element) => {
			if (!element) return false;
			const box = element.getBoundingClientRect();
			return box.height > 100 && box.width > 0;
		};
		const paneBox = (slot) => {
			for (let node = slot; node && node !== document.body; node = node.parentElement) {
				if (hasBox(node)) return node;
			}
			return null;
		};
		const schedule = (measure = false) => {
			if (disposed) return;
			forceMeasure ||= measure;
			if (pending) return;
			pending = window.setTimeout(reconcile, 40);
		};
		const resizeObserver = typeof ResizeObserver === "undefined"
			? null
			: new ResizeObserver(() => schedule(true));
		const reconcile = () => {
			pending = 0;
			if (disposed) return;
			const main = document.querySelector('[data-slot="main"]');
			const sidebar = document.querySelector('[data-slot="sidebar"]');
			const pane = marks.get("data-u02-pane")?.element;
			const column = marks.get("data-u02-sidebar")?.element;
			if (forceMeasure || main !== previousMain || !pane?.isConnected || (main && !pane.contains(main))) {
				mark("data-u02-pane", paneBox(main));
			}
			if (forceMeasure || sidebar !== previousSidebar || !column?.isConnected || column !== sidebar?.parentElement) {
				mark("data-u02-sidebar", hasBox(sidebar?.parentElement) ? sidebar.parentElement : null);
			}
			previousMain = main;
			previousSidebar = sidebar;
			forceMeasure = false;
			const targets = new Set([
				main?.parentElement, sidebar?.parentElement,
				...Array.from(marks.values(), ({ element }) => element)
			].filter(Boolean));
			for (const node of observed) {
				if (!targets.has(node)) {
					resizeObserver?.unobserve(node);
					observed.delete(node);
				}
			}
			for (const node of targets) {
				if (!observed.has(node)) {
					resizeObserver?.observe(node);
					observed.add(node);
				}
			}
		};
		const observer = new MutationObserver((records) => {
			let changed = false;
			let measure = false;
			for (const record of records) {
				if (record.target instanceof Element && record.target.closest(".u02-boot, .u02-gauge")) continue;
				changed = true;
				if (record.type === "attributes") measure = true;
			}
			if (changed) schedule(measure);
		});
		observer.observe(document.body, {
			childList: true, subtree: true, attributes: true,
			attributeFilter: ["class", "style", "hidden", "data-slot"]
		});
		const onResize = () => schedule(true);
		window.addEventListener("resize", onResize);
		reconcile();

		let dropBoot = mountBoot();
		const replay = (event) => {
			if (event.detail?.id && event.detail.id !== config.id) return;
			dropBoot();
			dropBoot = mountBoot(true);
		};
		window.addEventListener("dsh-theme:replay", replay);
		return () => {
			disposed = true;
			observer.disconnect();
			resizeObserver?.disconnect();
			if (pending) window.clearTimeout(pending);
			window.removeEventListener("resize", onResize);
			window.removeEventListener("dsh-theme:replay", replay);
			dropBoot();
			gauge.remove();
			style.remove();
			for (const [attribute, { element, owned }] of marks) {
				if (owned) element.removeAttribute(attribute);
			}
			marks.clear();
		};
	}

	function installSkin() {
		let drop = noop;
		const mount = () => { drop = mountSkin(); };
		if (document.body) mount();
		else document.addEventListener("DOMContentLoaded", mount, { once: true });
		return () => {
			document.removeEventListener("DOMContentLoaded", mount);
			drop();
		};
	}

	function apply(ctx) {
		ctx.effect(() => {
			const theme = ctx.theme;
			let mounted = false;
			let disposed = false;
			let dropTokens = noop;
			let dropSkin = noop;

			const sync = (snapshot) => {
				if (disposed) return;
				// Dark skins follow the user's resolved scheme; never write preferences.
				const wantsSkin = snapshot.active.colorScheme === "dark";
				if (wantsSkin === mounted) return;
				// Set before overrideTokens emits its nested theme/change event.
				mounted = wantsSkin;
				if (mounted) {
					dropTokens = theme.overrideTokens(config.id, darkTokens);
					dropSkin = installSkin();
				} else {
					dropSkin();
					dropSkin = noop;
					dropTokens();
					dropTokens = noop;
				}
			};
			const off = ctx.on("theme/change", sync);
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				off();
				dropSkin();
				dropTokens();
			};
			try {
				sync(theme.getTheme());
				return cleanup;
			} catch (error) {
				cleanup();
				throw error;
			}
		}, `${config.id}: skin and palette`);
	}

	return { apply, inject: ["theme"] };
}
