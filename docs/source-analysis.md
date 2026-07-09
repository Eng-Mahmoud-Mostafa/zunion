# Zunion Source File Analysis

## Uploaded Instruction Text

The uploaded brief asks for a full internal Zunion order management system with:

- React + TypeScript + Vite frontend
- Node.js + Express + TypeScript backend
- PostgreSQL database
- Local `/uploads` file storage
- Email OTP authentication with HTTP-only cookie sessions
- Four roles: Master, Helper, Worker, Finish
- Role-specific workflow screens and permissions
- Excel import/export
- Printable order sheets
- Customer account management
- Audit logs
- Docker Compose deployment

## Uploaded Excel Workbook

File inspected:

`C:\Users\DELL\Downloads\00 (1) (1).xlsx`

Workbook structure:

- Sheets: `Sheet1`
- Used range: `A1:M27`
- The file is not a normal database table. It is a formatted manual workflow sheet with merged cells and sections.

Important cells:

- `A4`: order number = `26-6-8-000112`
- `B4`: source/party = `حسن`
- `C4`: customer name = `احمد عصام`
- `D4`: customer code = `115`
- `A8`: phone = `1111577055`
- `B7`: delivery date, formatted as `10/6/26`
- `C7`: price = `52`
- `D7`: total = `2600`
- `E7`: paid = `1600`
- `F7`: remaining = `1000`
- `G7`: old balance = `2000`
- `H7`: net account = `3000`
- `A12`: type = `كتابه`
- `B12`: quantity = `50`
- `C12`: logo = `كتابه`
- `D12`: work order action = `رفع صوره`
- `E12`: notes = `هنسلم بكره ان شاء الله`
- `F12:G12`: quality/damaged note = `الجوده - قطعه مقطوعه`

Workflow sections found:

- New order section near rows 1-12
- Send to production section near row 15
- Send to finishing section near row 21
- Ready section near row 27

Implementation note:

The importer now detects this formatted Zunion sheet and reads the real cell positions above before falling back to generic table import.

## Uploaded Logo

File copied into the app:

`public/logo-zunion.pdf`

The UI now uses this uploaded PDF logo asset through `BrandLogo`, with the previous PNG logo as a fallback.
