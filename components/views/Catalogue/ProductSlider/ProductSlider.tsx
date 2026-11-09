import Anchor from "@/modules/Anchor";
import { motion } from "framer-motion";
import Image from "next/image";
import { MutableRefObject, useRef } from "react";
import { FiChevronRight } from "react-icons/fi";
import { useScroll } from "react-use";
import { Product, SubCategory } from "types/products";

interface IProductSliderProps {
  title: string;
  description: string;
  products: any[];
  btn: {
    title: string;
    href: string;
  };
}
const ProductSlider = ({
  title,
  description,
  products,
  btn,
}: IProductSliderProps) => {
  const scrollRef = useRef<any>(null);
  const { x } = useScroll(scrollRef);

  return (
    <div className="relative  w-full   flex flex-col gap-8">
      <motion.div className=" flex sm:hidden  flex-col   shrink-0 w-full    justify-center gap-4 ">
        <h2 className="text-3xl font-semibold">{title}</h2>
        <div>{description}</div>
        {/*<Anchor href={btn.href}>
          <button className="bg-transparent text-black border-2 mt-2 border-black hover:bg-black hover:text-white max-w-max py-2">
            {btn.title}
          </button>
        </Anchor>*/}
      </motion.div>

      <div className=" absolute h-full sm:flex right-0 top-0 p-6 hidden ">
        <div className=" w-12 h-12  flex items-center justify-center text-2xl   shadow-xl ring ring-slate-50 hover:ring-slate-300 rounded-full z-50 cursor-pointer bg-white mt-[80px]">
          <FiChevronRight
            onClick={() => {
              scrollRef.current.scrollBy({
                left: 500,
                behavior: "smooth",
              });
            }}
          />
        </div>
      </div>
      <div
        className="w-full  flex gap-6 overflow-scroll relative items-center "
        ref={scrollRef}
      >
        <motion.div
          className="sm:flex hidden flex-col   shrink-0 w-56  h-72  justify-center     py-4 gap-4 sticky  left-0 snap-x "
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 - x / 50 }}
          transition={{ duration: 0.05 }}
        >
          <h2 className="text-3xl font-semibold">{title}</h2>
          <div className="font-light">{description}</div>
          {/*<Anchor href={btn.href}>
            <button className="bg-transparent text-black border-2 mt-2 border-black hover:bg-black hover:text-white max-w-max py-2">
              {btn.title}
            </button>
          </Anchor>*/}
        </motion.div>

        {products.map((product, i) => (
          <Anchor
            href={
              product.price
                ? `$/products/${product.slug}`
                : `/products?subcategory=${product.slug}`
            }
            key={i}
            className="hover:no-underline z-10 min-w-full sm:min-w-max "
          >
            <div className="flex flex-col w-full  group   cursor-pointer   sm:w-56 border-slate-800 border-[1px] p-4 h-full shadow-md">
              <motion.div className="  w-full pt-[100%]  relative transition-all  duration-500   bg-white ">
                <Image
                  fill
                  src={product.image || "/product-4.png"}
                  blurDataURL="/product-2.png"
                  placeholder="blur"
                  className="scale-75 group-hover:scale-[0.8] transition-all  "
                  alt="product"
                />
              </motion.div>
              <div className="text-xl px-3 py-1.5 font-light  flex justify-center  text-center  gap-12  whitespace-pre">
                <h3 className="text-2xl font-medium">{product.title}</h3>
                {product.price && <h3>{product.price}</h3>}
              </div>
            </div>
          </Anchor>
        ))}
      </div>
    </div>
  );
};

export default ProductSlider;
