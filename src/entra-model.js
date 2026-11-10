import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%*-_+=";

function pick(alphabet) {
  return alphabet[randomInt(alphabet.length)];
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function generatePassword(length = 20) {
  const required = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  const rest = Array.from({ length: Math.max(0, length - required.length) }, () => pick(all));
  return shuffle([...required, ...rest]).join("");
}

export function passwordIsStrong(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 64) return false;
  if (/\s/.test(value)) return false;
  const classes = [/[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  return classes >= 3;
}

export function methodKind(odataType) {
  const text = String(odataType ?? "").toLowerCase();
  if (text.includes("password")) return "password";
  if (text.includes("microsoftauthenticator")) return "microsoftAuthenticator";
  if (text.includes("phone")) return "phone";
  if (text.includes("fido2")) return "fido2";
  if (text.includes("softwareoath")) return "softwareOath";
  if (text.includes("email")) return "email";
  if (text.includes("windowshello")) return "windowsHelloForBusiness";
  if (text.includes("temporaryaccesspass")) return "temporaryAccessPass";
  return "unknown";
}

export function methodPath(kind) {
  return {
    microsoftAuthenticator: "microsoftAuthenticatorMethods",
    phone: "phoneMethods",
    fido2: "fido2Methods",
    softwareOath: "softwareOathMethods",
    email: "emailMethods",
    windowsHelloForBusiness: "windowsHelloForBusinessMethods",
    temporaryAccessPass: "temporaryAccessPassMethods",
  }[kind] ?? null;
}

export function methodLabel(method) {
  const kind = methodKind(method["@odata.type"]);
  const names = {
    password: "Senha",
    microsoftAuthenticator: "Authenticator",
    phone: "Telefone",
    fido2: "Chave FIDO2",
    softwareOath: "Aplicativo OTP",
    email: "E-mail",
    windowsHelloForBusiness: "Windows Hello",
    temporaryAccessPass: "Passe temporário",
  };
  const extra = method.displayName || method.phoneNumber || method.emailAddress || "";
  return `${names[kind] || "Método"}${extra ? ` · ${extra}` : ""}`.slice(0, 100);
}
