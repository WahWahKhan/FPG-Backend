import index from "@/modules/Loading";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

type Props = {};

const ProductsHeroHome = (props: Props) => {
  const images = useMemo(
    () => ["/frontA.png", "/frontB.png", "/frontC.png", "/frontD.png"],
    []
  );

  const [selectedImage, setSelectedImage] = useState(images[0]);

  const [direction, setDirection] = useState(true);

  const variants = {
    enter: {
      x: 80,
      opacity: 0,
    },
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: {
      zIndex: 0,
      x: -80,
      opacity: 0,
    },
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setSelectedImage(
        (selectedImage) =>
          images[
            images.indexOf(selectedImage) + 1 <= images.length - 1
              ? images.indexOf(selectedImage) + 1
              : 0
          ]
      );
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [images]);

  return (
    <div className="md:max-w-full  md:w-1/2  w-full      h-full flex items-center justify-center mx-auto relative">
      <AnimatePresence exitBeforeEnter>
        <motion.div
          variants={variants}
          className="sm:w-[75%] w-full max-w-sm sm:max-w-full   aspect-square gap-8   overflow-hidden  border rounded-2xl border-slate-200"
          key={selectedImage}
          custom={direction}
          transition={{
            duration: 0.4,
          }}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="relative p-4 w-full h-full -z-20">
            <Image
              src={selectedImage}
              layout="fill"
              objectFit="cover"
              placeholder="blur"
              blurDataURL="https://images.unsplash.com/photo-1515630771457-09367d0ae038?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80"
              alt="hero"
            />
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="absolute h-full  bottom-0 left-0 w-full  items-end justify-center pb-12 gap-4 hidden sm:flex">
        {images.map((item, i) => (
          <div
            onClick={() => {
              setDirection(i >= images.indexOf(selectedImage));

              setSelectedImage(item);
            }}
            className={clsx(
              "w-3 aspect-square rounded-full cursor-pointer",
              item === selectedImage ? "bg-black/60" : "bg-slate-200"
            )}
            key={i}
          ></div>
        ))}
      </div>
    </div>
  );
};

export default ProductsHeroHome;
