export type BillRow = {
  id: number;
  name: string;
  company: string | null;
  frequency: string;
  due_day: number | null;
  next_date: string | null;
  amount: number | null;
  autopay: 'Yes' | 'No';
  method: string | null;
  account: string | null;
  notes: string | null;
  created: string;
};

export type PaymentRow = {
  id: number;
  bill_id: number;
  occurrence_id: number | null;
  paid_date: string;
  amount: number | null;
  method: string | null;
  paid_by: string | null;
  confirm_num: string | null;
  notes: string | null;
};

export type DashboardOccurrenceRow = {
  occurrence_id: number;
  bill_id: number;
  due_date: string;
  expected_amount: number | null;
  bill_name: string;
  company: string | null;
  frequency: string;
  autopay: 'Yes' | 'No';
  payment_id: number | null;
  paid_date: string | null;
  paid_amount: number | null;
};

export type YearOccurrenceRow = {
  occurrence_id: number;
  payment_id: number | null;
  bill_id: number;
  bill_name: string;
  company: string;
  amount: number | null;
  due_date: string;
  frequency: string;
  autopay: 'Yes' | 'No';
  paid_date: string | null;
  paid_by: string | null;
  paid_amount: number | null;
};

export type YearOccurrenceOut = YearOccurrenceRow & { status: 'overdue' | 'due-soon' | 'upcoming' | 'paid' };
