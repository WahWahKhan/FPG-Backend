import Anchor from "@/modules/Anchor";
import { motion } from "framer-motion";
import Image from "next/image";

const ItemProducts = ({ item, showDescription }: { item: any, showDescription: false }) => {
  
  const getDescriptions = (description: string) => {
    //get text before first break tag
    const text = description.split("<br>")[0];
    const stripped = text.replace(/(<([^>]+)>)/ig, "").replace(/&nbsp;/g, "");
    return stripped + "...";
  }

  return (
    <Anchor href={`/products/${item.id}`}>
      <div className="flex flex-col w-full  max-w-sm    mx-auto group    cursor-pointer border-slate-800 border-[1px] p-4 h-full shadow-md">
        <motion.div className="w-full  pt-[100%]  relative  transition-all duration-500">
          <Image
            fill style={{ objectFit: "contain" }}
            src={item.image}
            blurDataURL={item.image}
            placeholder="blur"
            alt={item.slug}
            className="scale-75 group-hover:scale-[0.8] transition-all"
          />
        </motion.div>
        <div className="text-xl px-3 py-1.5 font-light flex justify-center gap-12">
          <h3 className="text-xl font-semibold"><b>{item.name || item.title}</b></h3>
        </div>
        {showDescription && <div className="text-center">
          <span className="text-xs font-semibold text-slate-700">
            {item.description && getDescriptions(item.description)}
          </span>
        </div>}
      </div>
    </Anchor>
  );
};

export default ItemProducts;
