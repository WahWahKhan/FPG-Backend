import { CartContext } from "context/CartWrapper";
import Image from "next/image";
import { useContext } from "react";
import { FiX } from "react-icons/fi";
import { IItemCart } from "types/cart";
import Counter from "../Counter";

type IItemCartProps = { item: IItemCart };

const ItemCart = ({ item }: IItemCartProps) => {
  const { updateItem, deleteItem } = useContext(CartContext);

  // Calculate the total price for the item based on its quantity
  const totalPrice = (item.price ?? 0) * item.quantity;

  return (
    <div className="p-5 border-b flex gap-4 justify-between select-none">
      <div className="flex gap-4 flex-grow">
        <div className="bg-white w-20 aspect-square p-2 min-w-fit">
          <div className="relative w-full h-full">
            <Image
              fill style={{ objectFit: "contain" }}
              src="/cartImage.jpeg"
              alt="product"
            />
          </div>
        </div>
        <div className="flex flex-col text-xl font-light gap-1 ">
          <h3>{item.name}</h3>
          <h4 className="text-base ">{item.name}</h4>
          <div className="w-24">
            <Counter
              limit={item.stock}
              count={item.quantity}
              setCount={(val) => {
                updateItem({ ...item, quantity: val });
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-between items-end text-xl font-light gap-1 ">
        <div
          className="text-2xl rounded-full cursor-pointer"
          onClick={() => {
            deleteItem(item);
          }}
        >
          <FiX />
        </div>
        <h4 className="text-lg ">${totalPrice.toFixed(2)}</h4>
      </div>
    </div>
  );
};

export default ItemCart;
