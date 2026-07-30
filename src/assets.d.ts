declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.generated.js" {
  const content: string;
  export default content;
}

declare module "*.woff2" {
  const path: string;
  export default path;
}
