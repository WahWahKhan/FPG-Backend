import { FiMail, FiPhone } from "react-icons/fi";
import ItemContact from "./ItemContact";

const ItemsContact = () => {
  const contactOptions = [
    {
      label: "General Queries",
      href: "mailto:info@fluidpowergroup.com.au",
      icon: FiMail,
      title: "info@fluidpowergroup.com.au",
    },
    {
      label: "Product Queries",
      href: "mailto:parts@fluidpowergroup.com.au",
      icon: FiMail,
      title: "parts@fluidpowergroup.com.au",
    },
    {
      label: "Sales",
      href: "tel:+61347203323",
      icon: FiPhone,
      title: "03 4720 3323",
    },
  ];

  return (
    <div className="grid grid-cols-6 gap-4 sm:gap-8">
      {contactOptions.map((item, i) => (
        <ItemContact key={i} {...item} />
      ))}
    </div>
  );
};

export default ItemsContact;
