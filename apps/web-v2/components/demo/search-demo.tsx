"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { createSearchSchema, type SearchValues } from "@/lib/demo/search-schema";

/**
 * Search field demonstration: React Hook Form + Zod, with every message taken
 * from the active dictionary. Submitting only echoes the term — there is no API
 * in Step 0 — but the validation path is the real one the catalog will use.
 */
export function SearchDemo() {
  const t = useTranslations("Home.inputs.search");
  const [result, setResult] = useState<string | null>(null);

  const schema = createSearchSchema({ required: t("required"), min: t("min") });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SearchValues>({
    resolver: zodResolver(schema),
    defaultValues: { query: "" },
  });

  return (
    <form
      role="search"
      noValidate
      onSubmit={handleSubmit((values) => setResult(t("result", { query: values.query })))}
      className="flex flex-col gap-3"
    >
      <TextField
        id="component-search"
        type="search"
        label={t("label")}
        placeholder={t("placeholder")}
        hint={t("hint")}
        error={errors.query?.message}
        leadingIcon={<Search />}
        autoComplete="off"
        {...register("query")}
      />
      <div>
        <Button type="submit">{t("submit")}</Button>
      </div>
      {result ? (
        <p role="status" className="text-body-md text-primary">
          {result}
        </p>
      ) : null}
    </form>
  );
}
