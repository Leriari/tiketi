"""
Outgoing email: purchase receipts and ticket-transfer notices.

Sent over SMTP (app/core/config.py SMTP_*) — on the free deployment that's
Gmail with an app password. Every message has a plain-text part and a
simple, table-free HTML part that reads well in Gmail and on phones. The
worker (app/worker.py) decides *when* to send; this module only builds and
delivers.
"""
import html
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.core.config import get_settings

NAIROBI = timedelta(hours=3)


class EmailNotConfigured(RuntimeError):
    pass


def send_email(to: str, subject: str, text: str, html_body: str) -> str:
    """Deliver one message; returns its Message-ID. Raises on failure so the
    caller (a Celery task) can retry."""
    settings = get_settings()
    if not settings.EMAIL_CONFIGURED:
        raise EmailNotConfigured("SMTP_HOST, SMTP_USERNAME and SMTP_PASSWORD must be set to send email.")
    sender = settings.EMAIL_FROM or settings.SMTP_USERNAME
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.EMAIL_FROM_NAME, sender))
    msg["To"] = to
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1])
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        smtp.send_message(msg)
    return msg["Message-ID"]


# ── Formatting ───────────────────────────────────────────────────────────────

def nairobi_time(dt: datetime | None, with_weekday: bool = True) -> str:
    """Stored datetimes are naive UTC; emails show East Africa Time."""
    if not dt:
        return ""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    local = dt + NAIROBI
    return local.strftime("%a %d %b %Y, %H:%M" if with_weekday else "%d %b %Y, %H:%M") + " EAT"


def kes(amount: float | int) -> str:
    return f"KES {amount:,.0f}"


def _row(label: str, value: str) -> str:
    return (
        '<tr><td style="padding:6px 0;color:#6b6b78;font-size:14px;">' + html.escape(label) + "</td>"
        '<td style="padding:6px 0;text-align:right;font-size:14px;color:#111;">' + value + "</td></tr>"
    )


def _layout(heading: str, intro: str, rows: list[tuple[str, str]], button: tuple[str, str] | None, footer: str) -> str:
    rows_html = "".join(_row(label, value) for label, value in rows)
    button_html = ""
    if button:
        label, url = button
        button_html = (
            f'<p style="margin:24px 0;"><a href="{html.escape(url)}" style="background:#c6f432;color:#111;'
            'padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">'
            f"{html.escape(label)}</a></p>"
        )
    return f"""<!doctype html>
<html><body style="margin:0;background:#f4f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:24px 16px;">
  <p style="font-size:18px;font-weight:700;color:#111;margin:0 0 16px;">ChainTix</p>
  <div style="background:#fff;border-radius:12px;padding:24px;">
    <h1 style="font-size:20px;color:#111;margin:0 0 8px;">{html.escape(heading)}</h1>
    <p style="font-size:15px;color:#333;margin:0 0 16px;line-height:1.5;">{intro}</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;">{rows_html}</table>
    {button_html}
  </div>
  <p style="font-size:12px;color:#6b6b78;line-height:1.5;margin:16px 4px;">{footer}</p>
</div></body></html>"""


def _text(heading: str, intro: str, rows: list[tuple[str, str]], button: tuple[str, str] | None, footer: str) -> str:
    lines = [heading, "", intro, ""]
    lines += [f"{label}: {value}" for label, value in rows]
    if button:
        lines += ["", f"{button[0]}: {button[1]}"]
    lines += ["", footer]
    return "\n".join(lines)


def _build(heading, intro_text, rows, button, footer):
    """(text, html) — rows are plain strings; the HTML side escapes them."""
    html_rows = [(label, html.escape(value)) for label, value in rows]
    return (
        _text(heading, intro_text, rows, button, footer),
        _layout(heading, html.escape(intro_text), html_rows, button, html.escape(footer)),
    )


FOOTER = ("You're receiving this because you bought or were sent a ticket on ChainTix. "
          "Your tickets are always in the app under My Tickets.")


def purchase_receipt(*, name: str | None, order_ref: str, event_title: str, event_date: datetime | None,
                     venue: str, tier_name: str, quantity: int, amount_kes: float, mpesa_receipt: str | None,
                     paid_at: datetime | None, phone: str, resale: bool, tickets_url: str) -> tuple[str, str, str]:
    """(subject, text, html) for a confirmed payment."""
    what = "resale ticket" if resale else f"ticket{'s' if quantity != 1 else ''}"
    heading = f"You're going to {event_title}"
    intro = (f"Hi {name.split()[0]}, " if name else "Hi, ") + (
        f"your payment went through and your {what} {'is' if quantity == 1 else 'are'} ready. "
        "Show the QR code in the app at the gate. It refreshes every 30 seconds, so screenshots won't work."
    )
    rows = [
        ("Event", event_title),
        ("When", nairobi_time(event_date)),
        ("Where", venue),
        ("Ticket", f"{quantity} × {tier_name}{' (resale)' if resale else ''}"),
        ("Total paid", kes(amount_kes)),
        ("M-Pesa receipt", mpesa_receipt or "—"),
        ("Paid from", phone),
        ("Paid on", nairobi_time(paid_at, with_weekday=False)),
        ("Order", order_ref),
    ]
    text, body = _build(heading, intro, rows, ("View my tickets", tickets_url), FOOTER)
    return f"Your ChainTix receipt: {event_title}", text, body


def transfer_notice(*, recipient_name: str | None, sender_name: str, event_title: str, event_date: datetime | None,
                    venue: str, tier_name: str, tickets_url: str) -> tuple[str, str, str]:
    heading = f"{sender_name} sent you a ticket"
    intro = (f"Hi {recipient_name.split()[0]}, " if recipient_name else "Hi, ") + (
        f"{sender_name} transferred a ticket to {event_title} to your ChainTix account. It's in My Tickets now."
    )
    rows = [("Event", event_title), ("When", nairobi_time(event_date)), ("Where", venue), ("Ticket", tier_name)]
    text, body = _build(heading, intro, rows, ("Open my tickets", tickets_url), FOOTER)
    return f"{sender_name} sent you a ticket to {event_title}", text, body
