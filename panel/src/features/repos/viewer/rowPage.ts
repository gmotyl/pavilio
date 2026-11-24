// Rows mounted at once; a file of many short lines passes the byte cap yet would mount a huge table.
// Its own module so a test can page a few dozen rows instead of mounting thousands.
export const ROW_PAGE = 5000;
