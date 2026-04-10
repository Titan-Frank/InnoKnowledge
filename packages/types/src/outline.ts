export interface OutlineData {
  [key: string]: unknown;
  book_id: string;
  title: string;
  items: OutlineItem[];
  structure?: OutlineItem[];
}

export interface OutlineItem {
  id: string;
  kind: string;
  label: string;
  title: string;
  page_start: number;
  page_end: number;
  order_path: string;
  children?: OutlineItem[];
}
