import { CartContext } from "context/CartWrapper";
import { AnimatePresence, motion } from "framer-motion";
import { useContext, useMemo } from "react";
import { IItemCart } from "types/cart";
import axios from "axios";
import { useRouter } from "next/router";

type IOrderSummaryProductProps = {
  items: IItemCart[];
  handleClear: () => void;
};

const OrderSummaryProduct = ({
  items,
  handleClear,
}: IOrderSummaryProductProps) => {
  const itemsAdded = useMemo(
    () => items.filter((item) => item.quantity),
    [items]
  );
  const router = useRouter();
  const { addItem } = useContext(CartContext);

  const totalPrice = useMemo(
    () => items.reduce((prev, curr) => prev + (curr.price ?? 0) * curr.quantity, 0),
    [items]
  );

  const salesTax = 0.1 * totalPrice;

  const handleAddToCart = () => {
    window.scroll({ behavior: "smooth", top: 0, left: 0 });

    itemsAdded.forEach((item) => {
      addItem(item);
    });

    handleClear();
  };

  const checkout = async () => {
    // Ensure handleAddToCart runs first
    handleAddToCart();

    // Proceed with checkout after items are added to the cart
    const body = items.map((item: any) => ({
      product_id: item.id,
      quantity: item.quantity,
    }));

    try {
      const cart = await axios.post(
        `${process.env.NEXT_PUBLIC_BASEURL}/createCart`,
        {
          items: body,
        }
      );

      if (cart.status === 200) {
        router.push(cart.data.checkout_url);
      }
    } catch (error) {
      console.error("Error during checkout:", error);
      // Optionally, you could show an alert or some error UI here
    }
  };

  return (
    <AnimatePresence mode="wait">
      {itemsAdded.length > 0 && (
        <motion.div
          className="wrapper px-8 md:px-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.6 } }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
        >
          <div className="w-full flex flex-col sm:items-end">
            <div className="flex flex-col gap-6 max-w-md w-full">
              <h2 className="text-3xl sm:text-4xl font-semibold">
                Order Summary
              </h2>

              <div className="flex flex-col gap-4">
                <div className="sm:text-xl font-normal flex flex-col gap-4">
                  {itemsAdded.map((item) => (
                    <div className="flex justify-between gap-8" key={item.name}>
                      <div>
                        {item.quantity} x {item.name}
                      </div>
                      <div>${(item.quantity * (item.price ?? 0)).toFixed(2)}</div>
                    </div>
                  ))}

                  <div className="flex justify-between gap-8 italic">
                    <div>GST (10%) </div>
                    <div>${salesTax.toFixed(2)}</div>
                  </div>
                </div>

                <div className="w-full border"></div>
                <div className="flex justify-between gap-8 sm:text-xl">
                  <div>Total</div>
                  <div>${(salesTax + totalPrice).toFixed(2)}</div>
                </div>
              </div>

              <div className="flex w-full gap-4 mt-2">
                <button className="min-w-max w-1/2" onClick={checkout}>
                  Checkout
                </button>
                <button
                  className="btn-secondary w-1/2"
                  onClick={handleAddToCart}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OrderSummaryProduct;
