// g4os-ds-disable-file hex-color -- favicon gerado por next/og (ImageResponse) não lê variáveis CSS; são as cores fixas do logo.
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 32,
        height: 32,
        background: "#14171c",
        borderRadius: 8,
        display: "flex",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 7,
          top: 10,
          width: 5,
          height: 5,
          borderRadius: 99,
          background: "#f7f8fa",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 19,
          top: 7,
          width: 5,
          height: 5,
          borderRadius: 99,
          background: "#f7f8fa",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 15,
          top: 18,
          width: 6,
          height: 6,
          borderRadius: 99,
          background: "#e45a8c",
        }}
      />
    </div>,
    size,
  );
}
