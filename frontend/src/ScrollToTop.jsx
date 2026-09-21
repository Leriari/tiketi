import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Classic BrowserRouter (not a data router) does no scroll restoration on its
// own, and every shell's <main> scrolls the window itself — so without this,
// navigating from a long page to a short one leaves the short page's content
// scrolled out of view above the fold.
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
