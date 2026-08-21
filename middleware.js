import { next } from "@vercel/functions";
import { isAuthorized, readSiteCredentials, unauthorizedResponse } from "./auth.mjs";

export default function middleware(request) {
  const credentials = readSiteCredentials();
  if (!isAuthorized(request, credentials)) {
    return unauthorizedResponse();
  }
  return next();
}
