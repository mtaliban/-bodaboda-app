/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Google Identity Services
interface GoogleCredentialResponse {
  credential: string;
  select_by: string;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize(config: { client_id: string; callback: (r: GoogleCredentialResponse) => void }): void;
        renderButton(element: HTMLElement, config: object): void;
        prompt(): void;
      };
    };
  };
  AppleID?: {
    auth: {
      init(config: {
        clientId: string;
        scope: string;
        redirectURI: string;
        usePopup: boolean;
      }): void;
      signIn(): Promise<{
        authorization: { id_token: string; code: string };
        user?: { name?: { firstName?: string; lastName?: string }; email?: string };
      }>;
    };
  };
}
