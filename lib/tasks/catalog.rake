namespace :catalog do
  desc "Import Magic sets and illustration-per-set data from Scryfall (~80 MB download)"
  task import: :environment do
    CatalogImport.new(logger: Logger.new($stdout)).call
  end
end
