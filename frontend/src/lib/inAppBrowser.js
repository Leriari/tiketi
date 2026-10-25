// Apps' built-in browsers (a link tapped inside Instagram, Facebook,
// TikTok…, or an Android WebView) can't do Google sign-in: Google refuses
// embedded browsers ("disallowed_useragent"). Detected from the user agent
// so the login screen can say so up front instead of failing mid-way.
const IN_APP = [
  [/WhatsApp/i, "WhatsApp"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/musical_ly|TikTok|BytedanceWebview/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/Twitter/i, "X"],
  [/LinkedInApp/i, "LinkedIn"],
  [/\bLine\//i, "LINE"],
  [/; wv\)/i, "this app"], // generic Android WebView
];

/** The app whose built-in browser this is, or null in a real browser. */
export function inAppBrowserName(ua = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  const hit = IN_APP.find(([pattern]) => pattern.test(ua));
  return hit ? hit[1] : null;
}
