export {};

declare global {
  interface Window {
    BILLLEDGER_API_BASE?: string;
    BillLedgerApp?: {
      init: () => void;
    };
  }
}
