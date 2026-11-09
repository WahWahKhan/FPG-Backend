import Image from "next/image";
import React from "react";
import Anchor from "../Anchor";

type ILogoProps = {
  type?: "header" | "footer";
};

const Logo = ({ type = "header" }: ILogoProps) => {
  return (
    <Anchor href="/">
      <div className="relative h-[90px] w-[220px] bg-transparent">
        <Image
          src={"/logo.png"}
          fill style={{ objectFit: "contain" }}
          alt="Site logo"
        />
      </div>
    </Anchor>
  );
};

export default Logo;
