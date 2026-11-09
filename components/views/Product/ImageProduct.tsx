import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import { useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

type Props = {
  images: string[];
};

const ImageProduct = ({ images }: Props) => {
  const [selectedImage, setSelectedImage] = useState(images[0]);

  const [direction, setDirection] = useState(true);

  const variants = {
    enter: {
      x: 100,
      opacity: 0,
    },
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: {
      zIndex: 0,
      x: -100,
      opacity: 0,
    },
  };

  const imageIndex = images.indexOf(selectedImage);

  return (
    <div className="relative col-span-full lg:col-span-6 xl:col-span-7 w-full border rounded-3xl h-full pt-[100%] lg:pt-0 lg:aspect-auto">
      <AnimatePresence mode="wait">
        <div className="absolute top-0 left-0 h-full w-full p-16">
          <motion.div
            variants={variants}
            className="relative h-full w-full "
            key={selectedImage}
            custom={direction}
            transition={{
              opacity: { duration: 0.2 },
            }}
            initial="enter"
            animate="center"
            exit="exit">
            <Image
              src={selectedImage}
              alt=""
              fill style={{ objectFit: "contain" }}
            />
          </motion.div>
        </div>
      </AnimatePresence>

      <div className="absolute h-full top-0 left-0   flex flex-col justify-center  ">
        <div
          className="p-2 hover:bg-slate-300/20 rounded-full cursor-pointer z-10 m-2 group"
          onClick={() => {
            setSelectedImage(
              images[
                (imageIndex > 0 ? imageIndex - 1 : images.length - 1) %
                  images.length
              ]
            );
          }}>
          <FiChevronLeft className="text-3xl text-black/60 group-hover:text-black group-hover:scale-110 transition-all duration-200 " />
        </div>
      </div>

      <div className="absolute h-full top-0 right-0   flex flex-col justify-center  ">
        <div
          className="p-2 hover:bg-slate-300/20 rounded-full cursor-pointer z-10 m-2 group"
          onClick={() => {
            setSelectedImage(
              images[(images.indexOf(selectedImage) + 1) % images.length]
            );
          }}>
          <FiChevronRight className="text-3xl text-black/60 group-hover:text-black group-hover:scale-110 transition-all duration-200 " />
        </div>
      </div>
      <div className="absolute h-full  bottom-0 left-0 w-full flex items-end justify-center pb-6 gap-4">
        {images.map((item, i) => (
          <div
            onClick={() => {
              setDirection(i >= images.indexOf(selectedImage));

              setSelectedImage(item);
            }}
            className={clsx(
              'w-3 aspect-square rounded-full cursor-pointer',
              item === selectedImage ? 'bg-black/60' : 'bg-slate-200'
            )}
            key={i}></div>
        ))}
      </div>
    </div>
  );
};

export default ImageProduct;
