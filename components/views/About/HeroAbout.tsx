import Image from "next/image";

const HeroAbout = () => {
  return (
    <div className="  aspect-video relative lg:w-2/3 ">
      <Image alt="team" fill style={{ objectFit: "cover" }} src="/About.jpeg" />
    </div>
  );
};

export default HeroAbout;
