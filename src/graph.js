import { withTimeout, azureFailureCode } from "./azure.js";

function coded(code) {
  return Object.assign(new Error(code), { code });
}

function escapeSearch(value) {
  return String(value ?? "").replace(/["\\]/g, "").trim().slice(0, 40);
}

export function createGraphClient(config, deps = {}) {
  const missing = {
    configured: false,
    async listUsers() {
      throw coded("azure_unconfigured");
    },
    async getUser() {
      throw coded("azure_unconfigured");
    },
    async resetPassword() {
      throw coded("azure_unconfigured");
    },
    async listMethods() {
      throw coded("azure_unconfigured");
    },
    async deleteMethod() {
      throw coded("azure_unconfigured");
    },
    async revokeSessions() {
      throw coded("azure_unconfigured");
    },
  };
  if (!config?.configured) return missing;

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const getToken = deps.getToken ?? (async () => {
    const identity = await import("@azure/identity");
    const credential = new identity.ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
    const token = await credential.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) throw coded("azure_failed");
    return token.token;
  });

  async function graph(path, { method = "GET", body } = {}) {
    return withTimeout(async () => {
      const token = await getToken();
      const response = await fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ConsistencyLevel: "eventual",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = response.status === 204 ? "" : await response.text();
      if (response.status === 403 || /authorization|forbidden/i.test(text)) throw coded("entra_forbidden");
      if (!response.ok) {
        const fallback = /default method|default authentication/i.test(text) ? "entra_default_method" : azureFailureCode({ statusCode: response.status, message: text, code: "azure_failed" });
        throw Object.assign(new Error("graph"), { code: fallback === "azure_forbidden" ? "entra_forbidden" : fallback });
      }
      return text ? JSON.parse(text) : null;
    });
  }

  return {
    configured: true,
    async listUsers({ search = "", page = 0 } = {}) {
      const query = new URLSearchParams({
        $select: "id,displayName,userPrincipalName,mail,otherMails,accountEnabled",
        $top: "25",
        $orderby: "displayName",
        $count: "true",
        $skip: String(Math.max(0, page) * 25),
      });
      const term = escapeSearch(search);
      if (term) query.set("$search", `"displayName:${term}" OR "mail:${term}" OR "userPrincipalName:${term}"`);
      const data = await graph(`/users?${query}`);
      return { users: data?.value ?? [], next: Boolean(data?.["@odata.nextLink"]) };
    },
    async getUser(id) {
      const query = new URLSearchParams({
        $select: "id,displayName,userPrincipalName,mail,otherMails,accountEnabled",
      });
      return graph(`/users/${encodeURIComponent(id)}?${query}`);
    },
    async resetPassword(id, { password, forceChangePasswordNextSignIn = false }) {
      await graph(`/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { passwordProfile: { password, forceChangePasswordNextSignIn: Boolean(forceChangePasswordNextSignIn) } },
      });
    },
    async listMethods(id) {
      const data = await graph(`/users/${encodeURIComponent(id)}/authentication/methods`);
      return data?.value ?? [];
    },
    async deleteMethod(id, kind, methodId) {
      const paths = {
        microsoftAuthenticator: "microsoftAuthenticatorMethods",
        phone: "phoneMethods",
        fido2: "fido2Methods",
        softwareOath: "softwareOathMethods",
        email: "emailMethods",
        windowsHelloForBusiness: "windowsHelloForBusinessMethods",
        temporaryAccessPass: "temporaryAccessPassMethods",
      };
      const segment = paths[kind];
      if (!segment) throw coded("entra_method_invalid");
      await graph(`/users/${encodeURIComponent(id)}/authentication/${segment}/${encodeURIComponent(methodId)}`, { method: "DELETE" });
    },
    async revokeSessions(id) {
      await graph(`/users/${encodeURIComponent(id)}/revokeSignInSessions`, { method: "POST" });
    },
  };
}
