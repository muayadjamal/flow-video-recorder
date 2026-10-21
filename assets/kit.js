// Helpers shared by motion-graphics scenes. Load after GSAP, before the scene.
//
// Everything is measured, never typed in: connectors start and end on the real
// edge of the element they join, and K.lint() reports overflow, overlaps and
// elements outside the world, which motion.mjs turns into a failed render.
(function () {
    const NS = 'http://www.w3.org/2000/svg';
    const world = () => document.getElementById('world');

    /** Box of an element in world coordinates (call before the camera moves). */
    const box = (el) => {
        const w = world().getBoundingClientRect();
        const r = (typeof el === 'string' ? document.querySelector(el) : el).getBoundingClientRect();
        const x = r.left - w.left;
        const y = r.top - w.top;
        return { x, y, w: r.width, h: r.height, cx: x + r.width / 2, cy: y + r.height / 2, r: x + r.width, b: y + r.height };
    };

    const anchor = (el, side, gap = 0) => {
        const b = box(el);
        return {
            left: [b.x - gap, b.cy],
            right: [b.r + gap, b.cy],
            top: [b.cx, b.y - gap],
            bottom: [b.cx, b.b + gap],
            center: [b.cx, b.cy],
        }[side];
    };

    const horizontal = (side) => side === 'left' || side === 'right';

    /**
     * A connector between two elements: a faint track plus a bright line that
     * draws on (tween its strokeDashoffset to 0). Returns { track, line, len }.
     */
    const link = (a, b, { from = 'right', to = 'left', gap = 14, curve = 0.5, cls = '' } = {}) => {
        const svg = document.getElementById('wires');
        const [x1, y1] = anchor(a, from, gap);
        const [x2, y2] = anchor(b, to, gap);
        const dx = (x2 - x1) * curve;
        const dy = (y2 - y1) * curve;
        const c1 = horizontal(from) ? [x1 + dx, y1] : [x1, y1 + dy];
        const c2 = horizontal(to) ? [x2 - dx, y2] : [x2, y2 - dy];
        const d = `M${x1},${y1} C${c1} ${c2} ${x2},${y2}`;
        const make = (klass) => {
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', d);
            p.setAttribute('class', klass);
            svg.appendChild(p);
            return p;
        };
        const track = make(`track ${cls}`);
        const line = make(`line ${cls}`);
        const len = line.getTotalLength();
        line.style.strokeDasharray = `${len}`;
        line.style.strokeDashoffset = `${len}`;
        return { track, line, len, d };
    };

    /** Put an absolutely positioned token's centre on a world point. */
    const place = (el, [x, y]) => {
        const r = el.getBoundingClientRect();
        gsap.set(el, { left: x - r.width / 2, top: y - r.height / 2, x: 0, y: 0 });
    };

    /** Cue time in seconds; throws if the narration has no such marker. */
    const cue = (name) => {
        const ms = (window.__CUES || {})[name];
        if (ms === undefined) throw new Error(`no cue {${name}} in the narration`);
        return ms / 1000;
    };

    const label = (el) => el.id ? `#${el.id}` : `${el.className.toString().split(' ')[0]} "${el.textContent.trim().slice(0, 30)}"`;

    /** Layout problems at the current (final) layout. */
    const lint = () => {
        const problems = [];
        const els = [...document.querySelectorAll('.lint')];
        const wb = box(world());
        els.forEach((el) => {
            // Every piece of text inside must sit inside the element, and must
            // not be clipped by its own box. Decorations (.deco) are exempt.
            const outer = box(el);
            el.querySelectorAll('*').forEach((d) => {
                if (d.closest('.deco')) return;
                const ownText = [...d.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
                if (!ownText) return;
                const b = box(d);
                if (b.x < outer.x - 1 || b.r > outer.r + 1 || b.y < outer.y - 1 || b.b > outer.b + 1) {
                    problems.push(`"${d.textContent.trim().slice(0, 30)}" sticks out of ${label(el)}`);
                }
                if (d.scrollWidth > d.clientWidth + 1 && getComputedStyle(d).overflow !== 'visible') {
                    problems.push(`"${d.textContent.trim().slice(0, 30)}" is clipped (${d.scrollWidth}px in ${d.clientWidth}px)`);
                }
            });
            const b = box(el);
            if (b.x < -1 || b.y < -1 || b.r > wb.w + 1 || b.b > wb.h + 1) {
                problems.push(`${label(el)} leaves the world`);
            }
        });
        for (let i = 0; i < els.length; i++) {
            for (let j = i + 1; j < els.length; j++) {
                const a = els[i];
                const c = els[j];
                if (a.contains(c) || c.contains(a)) continue;
                const p = box(a);
                const q = box(c);
                const ox = Math.min(p.r, q.r) - Math.max(p.x, q.x);
                const oy = Math.min(p.b, q.b) - Math.max(p.y, q.y);
                if (ox > 2 && oy > 2) problems.push(`${label(a)} overlaps ${label(c)} by ${ox.toFixed(0)}x${oy.toFixed(0)}px`);
            }
        }
        // Rows that are meant to line up: [data-row="name"] share a centre line.
        const rows = {};
        document.querySelectorAll('[data-row]').forEach((el) => (rows[el.dataset.row] ||= []).push(box(el).cy));
        Object.entries(rows).forEach(([name, ys]) => {
            const spread = Math.max(...ys) - Math.min(...ys);
            if (spread > 1) problems.push(`row "${name}" is off its centre line by ${spread.toFixed(1)}px`);
        });
        const cols = {};
        document.querySelectorAll('[data-col]').forEach((el) => (cols[el.dataset.col] ||= []).push(box(el).cx));
        Object.entries(cols).forEach(([name, xs]) => {
            const spread = Math.max(...xs) - Math.min(...xs);
            if (spread > 1) problems.push(`column "${name}" is off its centre line by ${spread.toFixed(1)}px`);
        });
        return problems;
    };

    /** A number that counts up, formatted, as a tween on the timeline. */
    const count = (tl, el, to, at, { from = 0, duration = 1, fmt = (v) => Math.round(v).toLocaleString('en-CA') } = {}) => {
        const o = { v: from };
        el.textContent = fmt(from);
        tl.to(o, { v: to, duration, ease: 'power2.out', onUpdate: () => (el.textContent = fmt(o.v)) }, at);
    };

    /** Gentle idle float for the whole clip, so nothing is ever frozen. */
    const float = (tl, el, { amp = 8, period = 2.6, delay = 0 } = {}) => {
        const total = (window.__DURATION_MS || 20000) / 1000;
        const reps = Math.ceil(total / period) + 1;
        tl.fromTo(el, { y: -amp / 2 }, { y: amp / 2, duration: period / 2, ease: 'sine.inOut', yoyo: true, repeat: reps * 2, immediateRender: false }, delay);
    };

    window.K = { box, anchor, link, place, cue, lint, count, float };
})();
