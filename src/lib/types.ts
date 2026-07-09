export type OrderStatus =
  | "أوردر جديد"
  | "يروح للتشغيل"
  | "التشغيل"
  | "يروح للتشطيب"
  | "التشطيب"
  | "الشغل جاهز"
  | "تم التسليم"
  | "مشكلة جودة";

export type Order = {
  id: string;
  order_number: string;
  source_person: string;
  client_name: string;
  client_code: string;
  phone: string;
  delivery_date: string;
  price: number;
  quantity: number;
  total: number;
  paid: number;
  remaining: number;
  old_balance: number;
  net_balance: number;
  order_type: string;
  logo_status: string;
  logo_image_url: string | null;
  work_order_image_url: string | null;
  quality_notes: string;
  operation_status: string;
  finishing_status: string;
  order_status: OrderStatus;
  client_message: string;
  notes: string;
  created_at?: string;
  updated_at?: string;
};

export type OrderInput = Omit<Order, "id" | "created_at" | "updated_at">;

export type Filters = {
  search: string;
  status: string;
  deliveryDate: string;
  sourcePerson: string;
  qualityIssue: boolean;
};
