#!/usr/bin/env python3
"""Builds docs/COMPANY_ADMIN_MANUAL.pdf  (needs: pip install reportlab).

Usage: python3 scripts/build_admin_manual.py [output.pdf]
Content is sourced from the app's screens and docs/DEMO_ONBOARDING_RUNBOOK.md,
docs/TENANT_CONFIGURATION.md. Update both when screens change.
"""
import sys
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/COMPANY_ADMIN_MANUAL.pdf"
GOLD = colors.HexColor("#B8860B")
NAVY = colors.HexColor("#0F172A")
SLATE = colors.HexColor("#475569")
LIGHT = colors.HexColor("#F1F5F9")
TIP_BG = colors.HexColor("#ECFDF5")
WARN_BG = colors.HexColor("#FEF3C7")

ss = getSampleStyleSheet()
body = ParagraphStyle("body", parent=ss["Normal"], fontName="Helvetica", fontSize=10, leading=14.5, textColor=colors.HexColor("#1E293B"), spaceAfter=6)
h1 = ParagraphStyle("h1", parent=body, fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=NAVY, spaceBefore=0, spaceAfter=10, keepWithNext=1)
h2 = ParagraphStyle("h2", parent=body, fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=GOLD, spaceBefore=12, spaceAfter=5, keepWithNext=1)
cell = ParagraphStyle("cell", parent=body, fontSize=9, leading=12, spaceAfter=0)
cellb = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold", textColor=colors.white)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=14, bulletIndent=3, spaceAfter=3)
num = ParagraphStyle("num", parent=body, leftIndent=18, bulletIndent=0, spaceAfter=3)


class Doc(BaseDocTemplate):
    def __init__(self, fn):
        super().__init__(fn, pagesize=A4, leftMargin=22*mm, rightMargin=22*mm, topMargin=22*mm, bottomMargin=20*mm,
                         title="Company Admin Manual", author="HRMS", subject="Getting started guide for Company Admins")
        f = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f")
        self.addPageTemplates([PageTemplate("cover", [f], onPage=self.cover_pg),
                               PageTemplate("main", [f], onPage=self.main_pg)])

    def cover_pg(self, c, d):
        w, h = A4
        c.setFillColor(NAVY); c.rect(0, 0, w, h, fill=1, stroke=0)
        c.setFillColor(GOLD); c.rect(0, h*0.42, w, 3, fill=1, stroke=0)

    def main_pg(self, c, d):
        w, h = A4
        c.setStrokeColor(GOLD); c.setLineWidth(1.2); c.line(22*mm, h-16*mm, w-22*mm, h-16*mm)
        c.setFont("Helvetica", 8); c.setFillColor(SLATE)
        c.drawString(22*mm, h-13*mm, "HRMS  |  Company Admin Manual")
        c.drawRightString(w-22*mm, 12*mm, f"Page {d.page - 1}")
        c.drawString(22*mm, 12*mm, "Keep this guide handy. It is your first stop for any question.")

    def afterFlowable(self, fl):
        if isinstance(fl, Paragraph) and fl.style.name in ("h1", "h2"):
            self.notify("TOCEntry", (0 if fl.style.name == "h1" else 1, fl.getPlainText(), self.page - 1))


def P(t, s=body): return Paragraph(t, s)
def B(items): return [Paragraph(i, bullet, bulletText="•") for i in items]
def N(items): return [Paragraph(i, num, bulletText=f"{n}.") for n, i in enumerate(items, 1)]


def box(title, text, bg, edge):
    t = Table([[Paragraph(f"<b>{title}</b>  {text}", cell)]], colWidths=[166*mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
                           ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return [t, Spacer(1, 8)]
def tip(t): return box("Tip:", t, TIP_BG, colors.HexColor("#10B981"))
def note(t): return box("Important:", t, WARN_BG, GOLD)


def table(rows, widths):
    data = [[Paragraph(c, cellb) for c in rows[0]]] + [[Paragraph(c, cell) for c in r] for r in rows[1:]]
    t = Table(data, colWidths=[w*mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                           ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    return [t, Spacer(1, 9)]


s = []
# ---------------- Cover ----------------
s += [Spacer(1, 70*mm),
      Paragraph("<font color='white' size=34><b>Company Admin<br/>Manual</b></font>", ParagraphStyle("c1", parent=body, leading=42)),
      Spacer(1, 8*mm),
      Paragraph("<font color='#CBD5E1' size=13>From your first sign-in to your first payroll run</font>", body)]
s += [Spacer(1, 78*mm), Paragraph("<font color='#94A3B8' size=9>Version 1.0  |  November 2026<br/>For the person who receives the workspace credentials.</font>", body)]
from reportlab.platypus.doctemplate import NextPageTemplate
s += [NextPageTemplate("main"), PageBreak()]

# ---------------- TOC ----------------
s.append(Paragraph("Contents", ParagraphStyle("ctitle", parent=h1)))
toc = TableOfContents()
toc.levelStyles = [ParagraphStyle("t0", parent=body, fontName="Helvetica-Bold", fontSize=10, leading=12, leftIndent=0, spaceBefore=3, spaceAfter=0),
                   ParagraphStyle("t1", parent=body, fontSize=8.5, leading=10, leftIndent=14, textColor=SLATE, spaceAfter=0)]
s += [toc, PageBreak()]

# ---------------- 1 Welcome ----------------
s.append(P("1. Welcome", h1))
s.append(P("You have been made the <b>Company Admin</b> of your organisation's HRMS workspace. This manual walks you "
           "through everything you need to get your company live: signing in, completing the one-time company setup, "
           "adding your people, and running day-to-day HR. When something is unclear, look here first."))
s.append(P("What your platform covers", h2))
s += table([["Area", "What it does"],
            ["Employees &amp; Org Chart", "Employee records, departments, reporting lines, documents, bulk import."],
            ["Leave", "Leave types, approval chains, holidays, balances, ledger, event-based leave (maternity, paternity, marriage)."],
            ["Attendance", "Clock-in/out, breaks, shifts, regularization requests, team rosters, monthly finalization."],
            ["Payroll", "Salary structures, EPF/ESI/Professional Tax/TDS, payroll runs, password-protected payslips, Full &amp; Final settlement."],
            ["Reports", "Headcount, joiners/leavers, attrition, payroll cost, Salary/PF/ESI/Gratuity registers (CSV/XLSX)."],
            ["Identity &amp; Access", "Users, roles, password resets, login trail and a full audit log."]], [42, 124])
s.append(P("Your role and the other roles", h2))
s += table([["Role", "What they can do"],
            ["<b>Company Admin</b> (you)", "Everything in the company: setup, users and roles, employees, leave, attendance, payroll approval, reports, audit."],
            ["HR Manager", "Day-to-day HR operations: employees, leave, attendance, payroll preparation, reports."],
            ["Line Manager", "Sees and approves requests for their own reporting line only."],
            ["Employee", "Own profile, attendance, leave, documents and payslips only."],
            ["Auditor", "Read-only access to employees, payroll, reports and audit. No create/edit/approve buttons."]], [42, 124])
s += tip("Roles are fixed in this version (there is no custom role builder). The server enforces them, so a hidden button is never the only protection.")

# ---------------- 2 First sign-in ----------------
s.append(PageBreak()); s.append(P("2. Your first sign-in", h1))
s.append(P("2.1 Set your password", h2))
s += N(["Open the email titled with a <b>password-set / reset</b> link sent to your work address when the workspace was created.",
        "Click the link and choose a password. This page is hosted securely by Firebase.",
        "If the email has not arrived within a few minutes, check spam, then ask your platform contact to <b>resend the admin reset</b>."])
s.append(P("2.2 Sign in", h2))
s += N(["Open the application link you were given and go to the <b>Login</b> page.",
        "Enter your <b>Company Subdomain</b> (your workspace name, e.g. <i>northwind</i>).",
        "Enter your email and password, then click <b>Sign in</b>."])
s += note("The subdomain is required. A correct email and password with the wrong subdomain will not sign you in.")
s.append(P("2.3 Forgot your password?", h2))
s.append(P("Use <b>Forgot password?</b> on the login page. A reset link is emailed to you. You can also ask any Company Admin to trigger a "
           "reset for you from <b>Identity &amp; Access &rarr; Users</b>."))
s.append(P("2.4 What you will see first", h2))
s.append(P("Because your workspace is new, you land on a full-screen <b>Company Setup</b>. Until it is submitted, nobody else in your company "
           "can use the app; they will see <i>\"Your workspace is being set up\"</i>. This is by design, so that the company never runs half-configured."))

# ---------------- 3 Company setup ----------------
s.append(PageBreak()); s.append(P("3. Company setup (one-time, mandatory)", h1))
s.append(P("Setup has <b>10 steps</b>. Each step must be free of errors before <b>Next</b> unlocks. Use <b>Save draft</b> at any time, "
           "and you can stop and resume later, even from another device. Nothing is applied to your company until the final "
           "<b>Submit</b>, which saves everything in one go or nothing at all."))
s += table([["#", "Step", "What to enter", "Notes"],
            ["1", "Company", "Legal name, address, city, state, PIN, contact email &amp; phone, optional GSTIN/CIN, <b>go-live date</b>.",
             "Leave for people without an imported balance is prorated from the go-live date."],
            ["2", "Departments", "At least one (e.g. Nursing, Admin, HR).", "Editable later under <b>Departments</b>."],
            ["3", "Your profile", "Your own employee record, linked to your login.", "Choose \"I'm not an employee\" if you won't be on payroll."],
            ["4", "Work week &amp; shifts", "Time zone, weekly-off days, shifts (start/end/grace), exactly one default shift.", "A 6-day week = Sunday off only."],
            ["5", "Attendance rules", "Capture mode, regularization window and monthly cap, what happens to unactioned requests, payroll cut-off day.", "Cut-off defaults to the 25th."],
            ["6", "Holidays", "Add manually or import CSV/XLSX with columns <b>date, name, type</b>.",
             "Mark optional holidays as OPTIONAL. Ambiguous dates like 03/04/2027 are rejected. Use YYYY-MM-DD."],
            ["7", "Leave policy", "Leave-year start month, 1 or 2 approval levels, escalation timers, loss-of-pay setting, leave types.",
             "Includes Restricted Holiday, comp-off and event-based presets (maternity, paternity, marriage...)."],
            ["8", "Import employees", "Optional employee file.", "Strict: departments must already exist; your own code is reserved."],
            ["9", "Opening balances", "Optional file: <b>employeeCode, leaveTypeCode, openingBalance</b>.", "For companies migrating from another HRMS."],
            ["10", "Review &amp; submit", "Review every warning and error, then submit.", "After submit, the workspace opens for everyone."]],
           [8, 27, 72, 59])
s += tip("Not sure about a value? Accept the suggested default and change it later. Almost everything is editable after setup. "
         "The exceptions you should think about now are the <b>go-live date</b> and <b>leave-year start</b>.")
s.append(P("Payroll is not part of setup", h2))
s.append(P("You can go live on the 1st and set payroll up at month-end. The Dashboard shows a <b>Set up payroll</b> card until the first salary structure exists."))

# ---------------- 4 Navigation ----------------
s.append(PageBreak()); s.append(P("4. Finding your way around", h1))
s.append(P("The left-hand menu lists every area available to you. As Company Admin you will see:"))
s += table([["Menu item", "Use it to..."],
            ["Dashboard", "See headcount, pending approvals and your payroll-setup reminder. Click any tile to drill down."],
            ["Employees", "Browse and search the directory, add people, bulk-import, open a profile."],
            ["Org Chart", "Interactive reporting tree. Hover for details."],
            ["Departments", "Create and rename departments."],
            ["Leave", "Requests, approvals, team calendar and balances, leave types, adjustments, ledger, holidays, settings."],
            ["Attendance", "Your own clock-in, plus team roster, approvals and settings."],
            ["Reports", "Run and export HR and payroll reports."],
            ["Payroll", "Structures, payroll runs and statutory settings."],
            ["Identity &amp; Access", "Users, roles, resets, and the audit trail."],
            ["Company", "Company profile (legal name, address, GSTIN, CIN)."],
            ["Email log", "Every email the system sent, with <b>Retry</b> for failures."]], [42, 124])
s.append(P("Your own <b>Account</b> page lets you view your profile and change your password. Items you cannot use are hidden; if a module is missing "
           "that you expect, your subscription plan may not include it (see Troubleshooting)."))

# ---------------- 5 Employees ----------------
s.append(PageBreak()); s.append(P("5. Adding and managing employees", h1))
s.append(P("5.1 Add one employee (with a login)", h2))
s += N(["Go to <b>Employees &rarr; Add employee</b>.",
        "Fill in employee code, name, designation, department, <b>reporting manager</b>, <b>date of joining</b>, <b>date of birth</b> and <b>work state</b>.",
        "Optionally enter annual CTC, PAN and bank account. These are encrypted and shown masked; revealing them is permission-controlled and logged.",
        "To give the person access, enter a <b>login email</b>, a <b>temporary password</b> and a <b>role</b>, then save.",
        "Share the temporary password securely and ask them to change it after first sign-in."])
s += note("A login can only be attached when the employee is <b>created</b>. It cannot be added to a record created through bulk import. "
          "Also, <b>date of birth is required for payslips</b>: the payslip PDF password is the DOB as DDMMYYYY.")
s += tip("Create managers before their reports, so you can pick the manager from the list.")
s.append(P("5.2 Bulk import", h2))
s += N(["Go to <b>Employees &rarr; Import</b> and click <b>Download the template</b>.",
        "Fill it in. Row 1 holds the headers, exactly: <b>employeeCode, firstName, lastName, personalEmail, phone, designation</b>.",
        "<b>Save the file as .xlsx.</b> The template downloads as CSV, but the server only reads .xlsx files.",
        "Upload it. The result shows how many succeeded and how many failed, with a reason per row.",
        "Click <b>download failed rows</b>, correct them and upload again. One bad row never blocks the good ones."])
s.append(P("Bulk import sets only the six core fields above. Department, reporting manager, joining date, DOB, work state and CTC are filled in afterwards by editing each employee. "
           "Imported people do not get a login. Use <b>Add employee</b> for anyone who needs to sign in."))
s.append(P("5.3 Editing, documents and lifecycle", h2))
s += B(["<b>Edit:</b> open a profile and change designation, department, manager, employment type, CTC or pay grade. Every change is recorded in the audit log with before/after values.",
        "<b>Photo and documents:</b> upload a profile photo and documents (ID proof etc.). Files up to 10 MB; each is virus-scanned and cannot be downloaded until the scan is clean.",
        "<b>Lifecycle:</b> move an employee from Confirmed to <b>Notice period</b> to <b>Separated</b>, entering the notice start and last working dates. Separation unlocks Full &amp; Final settlement in Payroll."])

# ---------------- 6 Users & access ----------------
s.append(PageBreak()); s.append(P("6. Users, roles and access", h1))
s.append(P("Open <b>Identity &amp; Access &rarr; Users</b> to see every login in your company."))
s += table([["Action", "How", "Effect"],
            ["Change role", "Pick a user, choose a new role.", "Applies on their next token refresh; recorded in audit."],
            ["Disable / enable", "Use the status control on the user.", "A disabled user cannot sign in. Their data is kept."],
            ["Reset password", "Use <b>Password reset</b> on the user.", "Emails them a reset link."],
            ["View activity", "Open a user's activity.", "See their recent sign-ins and changes."]], [32, 62, 72])
s.append(P("Audit trail", h2))
s.append(P("<b>Identity &amp; Access &rarr; Audit</b> has three views: the <b>login trail</b>, <b>access changes</b> (roles, status, resets) and "
           "<b>All activity</b>, which includes employee edits and payroll events. Login records are kept for two years."))
s += tip("Give the <b>Auditor</b> role to your accountant or external auditor. They get complete visibility with no ability to change anything.")

# ---------------- 7 Leave ----------------
s.append(PageBreak()); s.append(P("7. Leave management", h1))
s.append(P("Most leave rules were set in setup (step 7) and can be edited under <b>Leave &rarr; Settings</b> and <b>Leave &rarr; Leave Types</b>."))
s += table([["Tab", "Purpose"],
            ["Overview / Apply / My Requests", "Your own balances, requesting time off, and tracking requests. Working days exclude weekends and holidays automatically."],
            ["Approvals", "Requests waiting for you. With 2-level approval, HR or the reporting manager approves first and the second level follows."],
            ["Team Calendar / Team Balances", "Who is away, and everyone's remaining balances."],
            ["All Requests", "Every request in the company."],
            ["Leave Types", "Add or edit types: annual allowance, accrual (monthly/quarterly/annual), carry-forward, notice days, gender restriction, proof required."],
            ["Balance Adjustments / Ledger", "Credit or debit days with a reason, and see the full history of every balance movement."],
            ["Holidays", "View holidays, add one, or import CSV/XLSX."]], [52, 114])
s += B(["<b>Event-based leave</b> (maternity, paternity, marriage and others) is granted per event with its own limits and is never loss-of-pay.",
        "<b>Optional holidays</b> are taken as <b>Restricted Holiday</b> leave.",
        "<b>Comp-off:</b> if a tenant designates a comp-off type, working on a holiday or weekly-off credits it automatically.",
        "<b>Approved leave</b> marks those attendance days as <i>On leave</i>; cancelling reverses it."])

# ---------------- 8 Attendance ----------------
s.append(P("8. Attendance", h1))
s += B(["<b>Employees</b> clock in, start and end breaks, and clock out from the Attendance page. Late arrival, grace period, target hours and overtime follow the employee's shift.",
        "<b>Regularization:</b> an employee can request a correction (e.g. forgot to clock out) with evidence, within the window and monthly cap you configured. Managers and HR approve, reject or bulk-approve.",
        "<b>Team view:</b> HR and managers see a roster and can mark attendance manually. Manual marking is audited.",
        "<b>Nightly finalization:</b> each night the system marks holiday, weekly-off, present or genuine absence for the day. It never marks days before your go-live date.",
        "<b>Settings tab:</b> edit shifts and attendance rules at any time."])

# ---------------- 9 Payroll ----------------
s.append(PageBreak()); s.append(P("9. Payroll", h1))
s.append(P("Payroll is available on plans that include it. It uses a <b>maker-checker</b> model: no single person can release payroll."))
s.append(P("9.1 One-time payroll setup", h2))
s += N(["<b>Payroll &rarr; Settings:</b> review statutory settings (EPF wage ceiling, ESI, Professional Tax slabs for your work state) and the income-tax slabs. The NEW tax regime is the default.",
        "<b>Payroll &rarr; Structures:</b> create a salary structure for each paid employee. Set the effective date on or before the first day of the period. <b>Employees without a structure covering the period are not included in the run.</b>",
        "Make sure every paid employee has a <b>work state</b> and <b>date of birth</b>."])
s += tip("You can import salary structures in bulk from the Structures tab.")
s.append(P("9.2 Running payroll each month", h2))
s += table([["Step", "Status", "Who"],
            ["Create the run for the month (e.g. 2026-09)", "DRAFT", "HR or Company Admin"],
            ["Review line items: gross, EPF, ESI, PT, TDS, LOP, net. Adjust and <b>Recalculate</b> if needed", "DRAFT", "HR"],
            ["Submit for review", "REVIEW", "HR"],
            ["<b>Two different people approve.</b> One approval is not enough", "REVIEW &rarr; APPROVED", "HR + Company Admin"],
            ["<b>Process</b>: payslip PDFs are generated", "PROCESSED", "HR or Admin"],
            ["Download the <b>bank file</b>", "PROCESSED", "HR or Admin"],
            ["<b>Disburse</b> after payment is made", "DISBURSED", "HR or Admin"]], [92, 38, 36])
s += note("Approving twice with the same account counts once. A second run for an already-run month is refused unless you mark it as a re-process and give a reason.")
s.append(P("9.3 Payslips, corrections and exits", h2))
s += B(["<b>Payslips:</b> employees download them under Payroll &rarr; My Pay. The PDF is password-protected with their date of birth as <b>DDMMYYYY</b>.",
        "<b>Loss of pay</b> comes only from recorded absences and approved LOP leave. New companies with no attendance history get full pay.",
        "<b>Salary revisions</b> with a back-dated effective date generate arrears that fold into the next run.",
        "<b>TDS regime:</b> HR can override an employee's regime (audited).",
        "<b>Full &amp; Final:</b> for a Separated employee, Payroll &rarr; F&amp;F calculates unpaid salary, leave encashment, gratuity (5+ years of service, capped at Rs. 20 lakh) and advance recovery, with one approval."])

# ---------------- 10 Reports ----------------
s.append(P("10. Reports", h1))
s.append(P("Open <b>Reports</b> (Company Admin and HR Manager only). Available: headcount, joiners/leavers, attrition, payroll cost (employer cost vs planned CTC) and the Salary, PF, ESI and Gratuity registers. "
           "Each can be exported as <b>CSV or XLSX</b>. Payroll reports read only the latest processed run for each month and reproduce its stored figures, so they always match payslips."))

# ---------------- 11 Notifications ----------------
s.append(P("11. Emails and notifications", h1))
s.append(P("The system emails employees about leave decisions, regularizations, documents and account events. <b>Email log</b> lists every message and its status. "
           "Use <b>Retry</b> on any that failed. An address that hard-bounces or marks a message as spam is blocked automatically, so confirm the employee's email is correct and "
           "ask your platform contact to lift the block."))

# ---------------- 12 Security ----------------
s.append(PageBreak()); s.append(P("12. Security and good practice", h1))
s += B(["Your company's data is isolated from every other company at the database level. Platform operators see only your company name, plan and headcount, never employee records.",
        "Sensitive fields (PAN, bank account) are encrypted and masked. Revealing one requires permission and is logged.",
        "Aadhaar: only the last 4 digits are ever stored.",
        "Timestamps are stored in UTC and shown in Indian Standard Time.",
        "Do not share logins. Create a separate account for each person and use the <b>Auditor</b> role for read-only reviewers.",
        "Review <b>Identity &amp; Access &rarr; Users</b> regularly and <b>disable</b> accounts of people who leave.",
        "Choose a strong, unique password. Never email passwords; share temporary ones through a secure channel."])

# ---------------- 13 Troubleshooting ----------------
s.append(P("13. Troubleshooting and FAQ", h1))
s += table([["Problem", "What to do"],
            ["Reset email never arrives", "Check spam. Ask your platform contact to resend the admin reset. Confirm the address is spelled correctly."],
            ["Cannot sign in", "Check the <b>subdomain</b>, email and password. Use Forgot password. A suspended company or disabled user cannot sign in; contact your platform contact."],
            ["\"Your workspace is being set up\" shown to staff", "Company Setup has not been submitted. Finish and submit it (Section 3)."],
            ["A module (Payroll, Attendance) is missing or blocked", "Your subscription plan may not include it. Contact your platform contact to upgrade."],
            ["Workspace is read-only", "Your trial has ended or a payment has lapsed. Sign-in and viewing work but changes are refused until the plan is renewed."],
            ["Bulk import fails entirely", "The file must be <b>.xlsx</b> with exact headers. CSV is not accepted by the server."],
            ["Imported employee has no login", "Imports never create logins. Create the person with <b>Add employee</b> instead."],
            ["Employee missing from payroll run", "They have no salary structure effective for that period, or are not Active."],
            ["Payslip asks for a password", "Enter the employee's date of birth as DDMMYYYY (e.g. 05031990)."],
            ["Document stuck on \"scanning\"", "Wait a minute and refresh. Downloads are blocked until the virus scan passes. If it persists, contact support."],
            ["Holiday import rejects a date", "Use unambiguous dates such as 2027-03-04."],
            ["Line Manager cannot see someone", "Managers only see their own reporting line. Check the employee's reporting manager."]], [58, 108])

s.append(P("Getting help", h2))
s.append(P("If this manual does not answer your question, contact your HRMS platform representative (the team that created your workspace) and include: your company subdomain, "
           "your role, the page you were on, what you expected, and what happened (a screenshot helps). Never send passwords."))

# ---------------- Glossary / checklist ----------------
s.append(PageBreak()); s.append(P("Appendix A. Launch checklist", h1))
s += table([["", "Task"],
            ["[  ]", "Set password and sign in with the subdomain"],
            ["[  ]", "Complete and submit all 10 setup steps"],
            ["[  ]", "Add HR Manager and Line Managers (with logins and roles)"],
            ["[  ]", "Import or add all employees; set departments, managers, joining dates, DOB, work state"],
            ["[  ]", "Check leave types and holidays for the year"],
            ["[  ]", "Check shifts and the attendance payroll cut-off"],
            ["[  ]", "Set statutory and tax settings in Payroll"],
            ["[  ]", "Create a salary structure for every paid employee"],
            ["[  ]", "Run the first payroll with two different approvers"],
            ["[  ]", "Confirm a test email arrives; check the Email log"]], [14, 152])
s.append(P("Appendix B. Glossary", h1))
s += table([["Term", "Meaning"],
            ["Subdomain", "Your company's workspace name, used at sign-in."],
            ["Go-live date", "The date from which leave accrual and attendance finalization begin."],
            ["LOP", "Loss of pay: unpaid days deducted from salary."],
            ["EPF / ESI / PT / TDS", "Provident fund, state insurance, professional tax and income-tax deducted at source."],
            ["CTC", "Cost to company: the annual package."],
            ["Regularization", "A request to correct an attendance record."],
            ["Restricted Holiday", "Leave type used to take an optional holiday."],
            ["Comp-off", "Time off earned by working on a holiday or weekly-off."],
            ["Maker-checker", "Two different people must approve payroll."],
            ["F&amp;F", "Full and Final settlement for a departing employee."]], [42, 124])

doc = Doc(OUT)
doc.multiBuild(s)
print("wrote", OUT)
