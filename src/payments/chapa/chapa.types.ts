export interface ChapaInitializePayload {
  amount: string;
  currency: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  tx_ref: string;
  callback_url: string;
  return_url: string;
  customization?: {
    title?: string;
    description?: string;
  };
  meta?: Record<string, unknown>;
}

export interface ChapaInitializeResponse {
  message: string;
  status: 'success' | 'failed';
  data?: {
    checkout_url: string;
  };
}

export interface ChapaVerifyResponse {
  message: string;
  status: 'success' | 'failed';
  data?: {
    first_name: string;
    last_name: string;
    email: string;
    currency: string;
    amount: number;
    charge: number;
    mode: string;
    method: string;
    type: string;
    status: string;
    reference: string;
    tx_ref: string;
    customization: {
      title: string | null;
      description: string | null;
      logo: string | null;
    };
    meta: unknown;
    created_at: string;
    updated_at: string;
  };
}

export interface ChapaWebhookPayload {
  event?: string;
  tx_ref?: string;
  reference?: string;
  status?: string;
  amount?: string;
  currency?: string;
  payment_method?: string;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  mobile?: string;
  type?: string;
}

export interface ChapaCallbackQuery {
  trx_ref?: string;
  tx_ref?: string;
  ref_id?: string;
  status?: string;
}
