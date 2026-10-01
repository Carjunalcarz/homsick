import { configure } from "@testing-library/react";

// Under a full parallel run, jsdom renders can take longer than Testing
// Library's 1 s default for findBy*/waitFor, which made some tests flaky.
configure({ asyncUtilTimeout: 5_000 });
