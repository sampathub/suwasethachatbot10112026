export const handler = async (event: any) => {
  const ip = event.headers["client-ip"] || event.headers["x-forwarded-for"] || "Unknown";
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ ip }),
  };
};
