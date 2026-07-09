# Zunion Role Permissions

## Master

- Full dashboard access.
- Create, edit, delete, print, and upload files for any order.
- Change any order status.
- View all financial fields and customer accounts.
- Edit customer balances.
- View audit logs.

## Helper

- Create new orders.
- Edit orders until production starts.
- Upload logo/work-order files.
- Send orders to Worker.
- Print orders.
- Mark customer messaged.
- View customer accounts and limited financial information.
- Cannot delete orders or edit master-only account balances.

## Worker

- Sees production orders only.
- Can view order details, logo/photo, and work order files.
- Can set `WORKER_STARTED` and `WORKER_DONE`.
- Can add production notes and damaged/cut pieces.
- Cannot edit financial fields, delete orders, or access customer accounts.

## Finish

- Sees finishing orders only.
- Can view order details, logo/photo, and work order files.
- Can set `FINISH_STARTED`, `FINISH_DONE`, and `READY`.
- Can add finishing notes.
- Cannot edit financial fields, delete orders, or access customer accounts.
