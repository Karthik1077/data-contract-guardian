// A starter contract that matches public/sample-customers.csv.
export const SAMPLE_CONTRACT = JSON.stringify(
  {
    name: "customers_v1",
    min_rows: 1,
    columns: {
      customer_id: { type: "integer", required: true, unique: true, min: 1 },
      full_name: { type: "string", required: true, max_length: 50 },
      email: { type: "string", required: true, pattern: "[^@\\s]+@[^@\\s]+\\.[^@\\s]+" },
      age: { type: "integer", min: 18, max: 100 },
      status: { type: "string", required: true, allowed: ["active", "inactive", "pending"] },
      signup_date: { type: "date", required: true },
      balance: { type: "float" },
    },
  },
  null,
  2,
);
