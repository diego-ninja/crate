import { useState, useEffect, useCallback, useRef } from "react";

import { createUseApi } from "../../../shared/web/use-api";
import { api } from "@/lib/api";

export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api,
);
