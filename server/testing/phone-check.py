import json, sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3110/"
W, H = 390, 844

def overflow(page):
    return page.evaluate("""() => {
      const vw = document.documentElement.clientWidth;
      const scrolls = el => { for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
      const over = [];
      document.querySelectorAll('main *, #app *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1 && !scrolls(el)) {
          over.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' right=' + Math.round(r.right));
        }
      });
      return { vw, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 6), total: over.length };
    }""")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, is_mobile=True, has_touch=True, device_scale_factor=1)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_timeout(2500)
    # first run: load the example data so the pages have rows
    btn = page.locator("button", has_text="Start with the October 2026 example data")
    if btn.count():
        btn.first.click()
        page.wait_for_timeout(7000)
    links = page.evaluate("""() => [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter((v,i,arr)=>arr.indexOf(v)===i)""")
    results = {}
    for href in links:
        page.evaluate("(h) => { const a = [...document.querySelectorAll('a[href^=\"#\"]')].find(x => x.getAttribute('href') === h); if (a) a.click(); }", href)
        page.wait_for_timeout(700)
        results[href] = overflow(page)
    print(json.dumps({"width": W, "pages": len(results), "page_errors": errors[:5], "results": results}, indent=1))
    browser.close()
