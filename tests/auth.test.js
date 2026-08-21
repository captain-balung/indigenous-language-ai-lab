import assert from "node:assert/strict";
import {
  isAuthorized,
  parseBasicAuth,
  readSiteCredentials,
  unauthorizedHeaders,
  unauthorizedResponse,
  AUTH_REALM,
  UNAUTHORIZED_BODY
} from "../auth.mjs";

function fetchRequest(header) {
  const headers = new Headers();
  if (header !== undefined) headers.set("authorization", header);
  return new Request("https://example.test/", { headers });
}

function nodeRequest(header) {
  return { headers: header === undefined ? {} : { authorization: header } };
}

function basic(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

const credentials = { user: "lab", password: "s3cret" };

assert.equal(readSiteCredentials({}), null);
assert.equal(readSiteCredentials({ SITE_AUTH_USER: "lab" }), null);
assert.equal(readSiteCredentials({ SITE_AUTH_PASSWORD: "s3cret" }), null);
assert.equal(readSiteCredentials({ SITE_AUTH_USER: "  ", SITE_AUTH_PASSWORD: "s3cret" }), null);
assert.deepEqual(readSiteCredentials({ SITE_AUTH_USER: " lab ", SITE_AUTH_PASSWORD: "s3cret" }), credentials);

assert.equal(parseBasicAuth(""), null);
assert.equal(parseBasicAuth("Bearer abc"), null);
assert.equal(parseBasicAuth("Basic !!!"), null);
assert.deepEqual(parseBasicAuth(basic("lab", "s3cret")), credentials);
assert.deepEqual(parseBasicAuth(basic("lab", "a:b:c")), { user: "lab", password: "a:b:c" });

assert.equal(isAuthorized(fetchRequest(), credentials), false);
assert.equal(isAuthorized(fetchRequest(), null), false);
assert.equal(isAuthorized(fetchRequest("Bearer nope"), credentials), false);
assert.equal(isAuthorized(fetchRequest(basic("wrong", "s3cret")), credentials), false);
assert.equal(isAuthorized(fetchRequest(basic("lab", "wrong")), credentials), false);
assert.equal(isAuthorized(fetchRequest(basic("lab", "s3cret")), credentials), true);
assert.equal(isAuthorized(nodeRequest(basic("lab", "s3cret")), credentials), true);

const colonCredentials = { user: "lab", password: "p:ass:word" };
assert.equal(isAuthorized(fetchRequest(basic("lab", "p:ass:word")), colonCredentials), true);

const headers = unauthorizedHeaders();
assert.equal(headers["WWW-Authenticate"], `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
assert.equal(headers["Cache-Control"], "no-store");

const response = unauthorizedResponse();
assert.equal(response.status, 401);
assert.equal(await response.text(), UNAUTHORIZED_BODY);

console.log("PASS: Basic Auth helper rejects missing or wrong credentials and accepts valid ones");
